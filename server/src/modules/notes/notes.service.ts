import { basename, extname } from 'node:path';
import { NotificationType, Prisma, Role } from '@prisma/client';
import type { Express } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { localDiskStorage } from './storage.service.js';
import { notifyAfterCommit, notifyCourseStudents, notifyOrganizationStudents } from '../notifications/notifications.service.js';
import { canAccessContent, requireContentAccess } from '../student-portal/content-access.service.js';

const maximumFileSize = 20 * 1024 * 1024;
const allowedTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

type NoteInput = { title: string; subject: string; description: string; courseId?: string | null; freePreview?: boolean };
type NoteListInput = { search?: string; subject?: string; courseId?: string; saved?: 'true' | 'false' | 'all' };

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function safeNoteSelect() {
  return {
    id: true,
    title: true,
    subject: true,
    description: true,
    originalName: true,
    published: true,
    freePreview: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true, role: true } },
    course: { select: { id: true, title: true, code: true } },
  } satisfies Prisma.NoteSelect;
}

async function validateCourse(organizationId: string, courseId: string | null | undefined, userId?: string, role?: Role) {
  if (!courseId) return;
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId,
      ...(role === Role.TUTOR && userId ? { instructors: { some: { instructorId: userId } } } : {}),
    },
    select: { id: true },
  });
  if (!course) throw new HttpError(404, 'Course not found in your organization');
}

async function validateNoteCourseAccess(
  organizationId: string,
  note: { courseId: string | null },
  userId: string,
  role: Role,
) {
  if (role === Role.TUTOR && note.courseId) await validateCourse(organizationId, note.courseId, userId, role);
}

async function storeUpload(file: Express.Multer.File | undefined) {
  if (!file) return null;
  const extension = extname(file.originalname).toLowerCase();
  const expectedMimeType = allowedTypes.get(extension);
  if (!expectedMimeType || file.mimetype.toLowerCase() !== expectedMimeType) {
    throw new HttpError(400, 'Only PDF, PNG, JPG, and WEBP files with matching extensions and MIME types are allowed');
  }
  if (file.size > maximumFileSize) throw new HttpError(413, 'Note files must be 20 MB or smaller');
  const originalName = basename(file.originalname.replaceAll('\\', '/')).replace(/[\r\n"]/g, '').slice(0, 255);
  if (!originalName) throw new HttpError(400, 'The uploaded file must have a valid filename');
  const storageKey = await localDiskStorage.save(file.buffer, extension);
  return { storageKey, originalName, mimeType: expectedMimeType };
}

function isVisible(note: { published: boolean; authorId: string }, userId: string, role: Role): boolean {
  if (role === Role.STUDENT) return note.published;
  return note.published || note.authorId === userId || role === Role.ORG_ADMIN;
}

function requireNoteOwner(note: { authorId: string }, userId: string, role: Role): void {
  if (role !== Role.ORG_ADMIN && note.authorId !== userId) {
    throw new HttpError(403, 'You can manage only notes you created');
  }
}

async function findNote(organizationId: string, noteId: string) {
  const note = await prisma.note.findFirst({
    where: { id: noteId, organizationId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      authorId: true,
      title: true,
      subject: true,
      courseId: true,
      description: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      published: true,
      freePreview: true,
    },
  });
  if (!note) throw new HttpError(404, 'Note not found');
  return note;
}

export async function listNotes(organizationId: string | null, userId: string, role: Role, input: NoteListInput) {
  const tenantId = requireOrganizationId(organizationId);
  if (input.saved && role !== Role.STUDENT) throw new HttpError(403, 'Only students can filter their saved notes');
  const activeCourseIds = role === Role.STUDENT
    ? (await prisma.enrollment.findMany({
      where: { organizationId: tenantId, studentId: userId, status: 'ACTIVE' },
      select: { courseId: true },
    })).map(({ courseId }) => courseId)
    : [];
  const visibilityConditions = role === Role.STUDENT
    ? [{ OR: [{ courseId: null }, { courseId: { in: activeCourseIds } }] }]
    : role === Role.TUTOR
      ? [
        { OR: [{ published: true }, { authorId: userId }] },
        { OR: [{ courseId: null }, { course: { instructors: { some: { instructorId: userId } } } }] },
      ]
      : [];
  if (role === Role.TUTOR && input.courseId) await validateCourse(tenantId, input.courseId, userId, role);
  const searchConditions = input.search
    ? [{
      OR: [
        { title: { contains: input.search, mode: 'insensitive' as const } },
        { subject: { contains: input.search, mode: 'insensitive' as const } },
      ],
    }]
    : [];
  const notes = await prisma.note.findMany({
    where: {
      organizationId: tenantId,
      deletedAt: null,
      ...(role === Role.STUDENT ? { published: true } : {}),
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(role === Role.STUDENT && (input.saved === 'true' || (!input.saved && env.STUDY_MATERIALS_SAVED_ONLY)) ? { savedBy: { some: { organizationId: tenantId, studentId: userId } } } : {}),
      ...(role === Role.STUDENT && input.saved === 'false' ? { savedBy: { none: { organizationId: tenantId, studentId: userId } } } : {}),
      ...(visibilityConditions.length || searchConditions.length
        ? { AND: [...visibilityConditions, ...searchConditions] }
        : {}),
      ...(input.subject ? { subject: { equals: input.subject, mode: 'insensitive' } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: safeNoteSelect(),
  });
  if (role !== Role.STUDENT) return {
    notes: role === Role.TUTOR
      ? notes.map((note) => note.author.id === userId ? note : {
        ...note,
        author: { id: '', name: 'Tutor', role: Role.TUTOR },
      })
      : notes,
  };
  const savedNoteIds = new Set((await prisma.savedNote.findMany({
    where: { organizationId: tenantId, studentId: userId, noteId: { in: notes.map(({ id }) => id) } },
    select: { noteId: true },
  })).map(({ noteId }) => noteId));
  return {
    notes: await Promise.all(notes.map(async (note) => ({
      ...note,
      saved: savedNoteIds.has(note.id),
      locked: !await canAccessContent({
        organizationId: tenantId,
        userId,
        role,
        courseId: note.course?.id ?? null,
        published: note.published,
        freePreview: note.freePreview,
      }),
    }))),
  };
}

export async function saveNote(organizationId: string | null, noteId: string, studentId: string, saved: boolean) {
  const tenantId = requireOrganizationId(organizationId);
  if (saved) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, organizationId: tenantId, published: true, deletedAt: null },
      select: { id: true, courseId: true, published: true, freePreview: true },
    });
    if (!note) throw new HttpError(404, 'Published note not found');
    await requireContentAccess({
      organizationId: tenantId,
      userId: studentId,
      role: Role.STUDENT,
      courseId: note.courseId,
      published: note.published,
      freePreview: note.freePreview,
    });
    await prisma.savedNote.upsert({
      where: { organizationId_noteId_studentId: { organizationId: tenantId, noteId, studentId } },
      create: { organizationId: tenantId, noteId, studentId },
      update: {},
    });
  } else {
    await prisma.savedNote.deleteMany({ where: { organizationId: tenantId, noteId, studentId } });
  }
  return { noteId, saved };
}

export async function createNote(
  organizationId: string | null,
  authorId: string,
  role: Role,
  input: NoteInput,
  file?: Express.Multer.File,
) {
  const tenantId = requireOrganizationId(organizationId);
  await validateCourse(tenantId, input.courseId, authorId, role);
  const upload = await storeUpload(file);
  try {
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          organizationId: tenantId,
          authorId,
          title: input.title,
          subject: input.subject,
          description: input.description,
          courseId: input.courseId ?? null,
          freePreview: input.freePreview ?? false,
          ...(upload ? upload : {}),
        },
        select: safeNoteSelect(),
      });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId: authorId,
          action: 'NOTE_CREATED',
          targetType: 'Note',
          targetId: created.id,
          metadata: { published: false, hasFile: Boolean(upload) },
        },
      });
      return created;
    });
    return note;
  } catch (error) {
    if (upload) {
      try {
        await localDiskStorage.remove(upload.storageKey);
      } catch (cleanupError) {
        logger.error({ err: cleanupError, storageKey: upload.storageKey }, 'Unable to remove an unreferenced note upload');
      }
    }
    throw error;
  }
}

export async function updateNote(
  organizationId: string | null,
  noteId: string,
  actorId: string,
  role: Role,
  input: Partial<NoteInput>,
) {
  const tenantId = requireOrganizationId(organizationId);
  const note = await findNote(tenantId, noteId);
  requireNoteOwner(note, actorId, role);
  await validateNoteCourseAccess(tenantId, note, actorId, role);
  if (input.courseId !== undefined) await validateCourse(tenantId, input.courseId, actorId, role);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.note.update({
      where: { id: note.id },
      data: input,
      select: safeNoteSelect(),
    });
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: 'NOTE_UPDATED',
        targetType: 'Note',
        targetId: note.id,
        metadata: { changedFields: Object.keys(input) },
      },
    });
    return result;
  });
  return updated;
}

export async function setNotePublished(
  organizationId: string | null,
  noteId: string,
  actorId: string,
  role: Role,
  published: boolean,
) {
  const tenantId = requireOrganizationId(organizationId);
  const note = await findNote(tenantId, noteId);
  requireNoteOwner(note, actorId, role);
  await validateNoteCourseAccess(tenantId, note, actorId, role);
  if (note.published === published) throw new HttpError(409, published ? 'Note is already published' : 'Note is already a draft');
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.note.update({ where: { id: note.id }, data: { published }, select: safeNoteSelect() });
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: published ? 'NOTE_PUBLISHED' : 'NOTE_UNPUBLISHED',
        targetType: 'Note',
        targetId: note.id,
        metadata: {},
      },
    });
    return updated;
  });
  if (published) {
    const payload = {
      type: NotificationType.CONTENT_PUBLISHED,
      title: 'New learning content',
      body: `${updated.title} is now available.`,
      courseId: updated.course?.id,
      link: updated.course ? `/student/courses/${updated.course.id}/materials` : '/student/courses',
      groupKey: updated.course ? `course:${updated.course.id}:content` : `organization:${tenantId}:content`,
      dedupeKey: `note:${updated.id}:published`,
    };
    await notifyAfterCommit(
      () => updated.course
        ? notifyCourseStudents(tenantId, updated.course.id, payload)
        : notifyOrganizationStudents(tenantId, payload),
      'note publication',
    );
  }
  return updated;
}

export async function softDeleteNote(organizationId: string | null, noteId: string, actorId: string, role: Role) {
  const tenantId = requireOrganizationId(organizationId);
  const note = await findNote(tenantId, noteId);
  requireNoteOwner(note, actorId, role);
  await validateNoteCourseAccess(tenantId, note, actorId, role);
  await prisma.$transaction(async (tx) => {
    await tx.note.update({ where: { id: note.id }, data: { deletedAt: new Date(), published: false } });
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: 'NOTE_DELETED',
        targetType: 'Note',
        targetId: note.id,
        metadata: { softDelete: true },
      },
    });
  });
}

export async function noteForView(organizationId: string | null, noteId: string, userId: string, role: Role) {
  const tenantId = requireOrganizationId(organizationId);
  const note = await findNote(tenantId, noteId);
  if (!isVisible(note, userId, role)) throw new HttpError(404, 'Note not found');
  await validateNoteCourseAccess(tenantId, note, userId, role);
  await requireContentAccess({
    organizationId: tenantId,
    userId,
    role,
    courseId: note.courseId,
    published: note.published,
    freePreview: note.freePreview,
  });
  if (role === Role.STUDENT) {
    await prisma.$transaction(async (tx) => {
      const view = await tx.noteView.create({ data: { organizationId: tenantId, noteId: note.id, userId } });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId: userId,
          action: 'NOTE_VIEWED',
          targetType: 'Note',
          targetId: note.id,
          metadata: { noteViewId: view.id },
        },
      });
    });
  }
  if (!note.storageKey) {
    return {
      note: { id: note.id, title: note.title, subject: note.subject, description: note.description, originalName: null },
      file: null,
    };
  }
  return {
    note: { id: note.id, title: note.title, subject: note.subject, description: note.description, originalName: note.originalName },
    file: { ...(await localDiskStorage.open(note.storageKey)), mimeType: note.mimeType ?? 'application/octet-stream', originalName: note.originalName ?? 'note' },
  };
}

export async function noteForDownload(organizationId: string | null, noteId: string, userId: string, role: Role) {
  const tenantId = requireOrganizationId(organizationId);
  if (role !== Role.ORG_ADMIN && role !== Role.TUTOR) {
    throw new HttpError(403, 'You do not have permission to download note files');
  }
  const note = await findNote(tenantId, noteId);
  if (!isVisible(note, userId, role)) throw new HttpError(404, 'Note not found');
  await validateNoteCourseAccess(tenantId, note, userId, role);
  if (!note.storageKey) throw new HttpError(404, 'This note has no attached file');
  const file = await localDiskStorage.open(note.storageKey);
  await prisma.auditLog.create({
    data: {
      organizationId: tenantId,
      actorId: userId,
      action: 'NOTE_DOWNLOADED',
      targetType: 'Note',
      targetId: note.id,
      metadata: {},
    },
  });
  return {
    ...file,
    mimeType: note.mimeType ?? 'application/octet-stream',
    originalName: note.originalName ?? 'note',
  };
}

import { basename, extname } from 'node:path';
import { Prisma, Role } from '@prisma/client';
import type { Express } from 'express';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { localDiskStorage } from './storage.service.js';

const maximumFileSize = 20 * 1024 * 1024;
const allowedTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

type NoteInput = { title: string; subject: string; description: string; courseId?: string | null };
type NoteListInput = { search?: string; subject?: string; courseId?: string };

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
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true, role: true } },
    course: { select: { id: true, title: true, code: true } },
  } satisfies Prisma.NoteSelect;
}

async function validateCourse(organizationId: string, courseId: string | null | undefined) {
  if (!courseId) return;
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId }, select: { id: true } });
  if (!course) throw new HttpError(404, 'Course not found in your organization');
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
      description: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      published: true,
    },
  });
  if (!note) throw new HttpError(404, 'Note not found');
  return note;
}

export async function listNotes(organizationId: string | null, userId: string, role: Role, input: NoteListInput) {
  const tenantId = requireOrganizationId(organizationId);
  const notes = await prisma.note.findMany({
    where: {
      organizationId: tenantId,
      deletedAt: null,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(role === Role.ORG_ADMIN ? {} : role === Role.STUDENT ? { published: true } : {
        OR: [{ published: true }, { authorId: userId }],
      }),
      ...(input.search ? {
        AND: [{
          OR: [
            { title: { contains: input.search, mode: 'insensitive' } },
            { subject: { contains: input.search, mode: 'insensitive' } },
          ],
        }],
      } : {}),
      ...(input.subject ? { subject: { equals: input.subject, mode: 'insensitive' } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: safeNoteSelect(),
  });
  return { notes };
}

export async function createNote(
  organizationId: string | null,
  authorId: string,
  input: NoteInput,
  file?: Express.Multer.File,
) {
  const tenantId = requireOrganizationId(organizationId);
  await validateCourse(tenantId, input.courseId);
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
  if (input.courseId !== undefined) await validateCourse(tenantId, input.courseId);
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
  if (note.published === published) throw new HttpError(409, published ? 'Note is already published' : 'Note is already a draft');
  return prisma.$transaction(async (tx) => {
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
}

export async function softDeleteNote(organizationId: string | null, noteId: string, actorId: string, role: Role) {
  const tenantId = requireOrganizationId(organizationId);
  const note = await findNote(tenantId, noteId);
  requireNoteOwner(note, actorId, role);
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
  if (role !== Role.ORG_ADMIN && role !== Role.INSTRUCTOR && role !== Role.STAFF) {
    throw new HttpError(403, 'You do not have permission to download note files');
  }
  const note = await findNote(tenantId, noteId);
  if (!isVisible(note, userId, role)) throw new HttpError(404, 'Note not found');
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

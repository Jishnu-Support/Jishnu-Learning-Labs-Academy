import { randomBytes } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { Express } from 'express';
import {
  AssessmentAttemptStatus, AttendanceMark, EnrollmentStatus, ExpertSessionStatus, LibraryKind,
  NotificationType, ResultReleaseMode, Role,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyAfterCommit, notifyCourseStudents } from '../notifications/notifications.service.js';
import { localDiskStorage } from '../notes/storage.service.js';
import { jitsiLiveClassProvider } from './live-class-provider.js';
import { canAccessContent, requireContentAccess } from './content-access.service.js';

type Actor = { organizationId: string | null; userId: string; role: Role };
const maxLibraryFileBytes = 20 * 1024 * 1024;

function tenantId(actor: Actor) {
  if (!actor.organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return actor.organizationId;
}

function requireManager(role: Role) {
  if (role !== Role.ORG_ADMIN && role !== Role.TUTOR) throw new HttpError(403, 'Tutor or Org Admin access is required');
}

async function canManageCourse(actor: Actor, courseId: string) {
  const organizationId = tenantId(actor);
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId,
      ...(actor.role === Role.TUTOR ? { instructors: { some: { instructorId: actor.userId } } } : {}),
    },
    select: { id: true },
  });
  if (!course) throw new HttpError(404, 'Course not found or not assigned to this Tutor');
}

async function canAccessCourse(organizationId: string, userId: string, courseId: string, selectedTutorId?: string) {
  return Boolean(await prisma.enrollment.findFirst({
    where: {
      organizationId,
      studentId: userId,
      courseId,
      status: EnrollmentStatus.ACTIVE,
      ...(selectedTutorId ? { selectedTutorId } : {}),
    },
    select: { id: true },
  }));
}

function sessionTabWhere(tab: 'LIVE' | 'UPCOMING' | 'PAST' | undefined, now: Date) {
  if (tab === 'LIVE') return { status: ExpertSessionStatus.LIVE };
  if (tab === 'UPCOMING') return {
    status: ExpertSessionStatus.SCHEDULED,
    startsAt: { gt: now },
  };
  if (tab === 'PAST') return {
    OR: [
      { status: { in: [ExpertSessionStatus.CANCELLED, ExpertSessionStatus.COMPLETED] } },
      { startsAt: { lte: now }, status: { in: [ExpertSessionStatus.SCHEDULED, ExpertSessionStatus.LIVE] } },
    ],
  };
  return {};
}

export async function listSessions(actor: Actor, tab?: 'LIVE' | 'UPCOMING' | 'PAST', courseId?: string) {
  const organizationId = tenantId(actor);
  const now = new Date();
  const where = {
    organizationId,
    AND: [sessionTabWhere(tab, now)],
    ...(courseId ? { courseId } : {}),
    ...(actor.role === Role.STUDENT ? {
      status: { not: ExpertSessionStatus.CANCELLED },
      OR: [
        { courseId: { in: (await prisma.enrollment.findMany({
          where: { organizationId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
          select: { courseId: true },
        })).map(({ courseId }) => courseId) } },
        { batch: { students: { some: { studentId: actor.userId, organizationId } } } },
      ],
    } : actor.role === Role.TUTOR ? {
      course: { instructors: { some: { instructorId: actor.userId } } },
    } : {}),
  };
  const sessions = await prisma.expertSession.findMany({
    where,
    select: {
      id: true, title: true, description: true, startsAt: true, durationMinutes: true, status: true, courseId: true, freePreview: true,
      course: { select: { id: true, code: true, title: true } },
      host: { select: { id: true, name: true } },
      attendances: actor.role === Role.STUDENT ? {
        where: { studentId: actor.userId }, select: { studentId: true, status: true, joinedAt: true },
      } : { select: { studentId: true, status: true, joinedAt: true } },
    },
    orderBy: { startsAt: 'asc' },
  });
  let tutorAttendanceKeys: Set<string> | null = null;
  if (actor.role === Role.TUTOR && sessions.length) {
    const courseIds = sessions.flatMap((session) => session.courseId ? [session.courseId] : []);
    const studentIds = [...new Set(sessions.flatMap((session) => session.attendances.map(({ studentId }) => studentId)))];
    const selectedEnrollments = await prisma.enrollment.findMany({
      where: {
        organizationId,
        courseId: { in: courseIds },
        studentId: { in: studentIds },
        status: EnrollmentStatus.ACTIVE,
        selectedTutorId: actor.userId,
      },
      select: { courseId: true, studentId: true },
    });
    tutorAttendanceKeys = new Set(selectedEnrollments.map(({ courseId: id, studentId }) => `${id}:${studentId}`));
  }
  const withAccess = actor.role === Role.STUDENT
    ? await Promise.all(sessions.map(async (session) => ({
      session,
      locked: !await canAccessContent({
        organizationId,
        userId: actor.userId,
        role: actor.role,
        courseId: session.courseId,
        published: true,
        freePreview: session.freePreview,
      }),
    })))
    : sessions.map((session) => ({ session, locked: false }));
  return withAccess.filter(({ session }) => {
    const endsAt = session.startsAt.getTime() + session.durationMinutes * 60_000;
    if (tab === 'LIVE') return now.getTime() >= session.startsAt.getTime() - 10 * 60_000 && now.getTime() <= endsAt;
    if (tab === 'UPCOMING') return session.startsAt > now;
    if (tab === 'PAST') return session.status === ExpertSessionStatus.CANCELLED ||
      session.status === ExpertSessionStatus.COMPLETED || now.getTime() > endsAt;
    return true;
  }).map(({ session, locked }) => {
    const host = actor.role === Role.TUTOR
      ? { id: actor.userId, name: session.host.id === actor.userId ? 'You' : 'Course Tutor' }
      : session.host;
    const attendances = actor.role === Role.TUTOR && tutorAttendanceKeys && session.courseId
      ? session.attendances.filter(({ studentId }) => tutorAttendanceKeys?.has(`${session.courseId}:${studentId}`) === true)
      : session.attendances;
    return {
      ...session,
      host,
      attendances,
      locked,
      joinAvailable: session.status !== ExpertSessionStatus.CANCELLED &&
        !locked &&
        now >= new Date(session.startsAt.getTime() - 10 * 60_000) &&
        now <= new Date(session.startsAt.getTime() + session.durationMinutes * 60_000),
    };
  });
}

export async function createSession(actor: Actor, input: {
  courseId: string; title: string; description: string; startsAt: string; durationMinutes: number; freePreview?: boolean;
}) {
  requireManager(actor.role);
  const organizationId = tenantId(actor);
  await canManageCourse(actor, input.courseId);
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= Date.now()) throw new HttpError(400, 'Schedule the class for a future time');
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.expertSession.create({
      data: {
        organizationId,
        hostId: actor.userId,
        courseId: input.courseId,
        title: input.title,
        description: input.description,
        startsAt,
        durationMinutes: input.durationMinutes,
        freePreview: input.freePreview ?? false,
        roomName: `jll-${randomBytes(24).toString('base64url')}`,
      },
    });
    await tx.auditLog.create({
      data: { organizationId, actorId: actor.userId, action: 'EXPERT_SESSION_SCHEDULED', targetType: 'ExpertSession', targetId: created.id, metadata: { courseId: input.courseId, startsAt } },
    });
    return created;
  });
  await notifyAfterCommit(() => notifyCourseStudents(organizationId, input.courseId, {
    type: NotificationType.SESSION_SCHEDULED,
    courseId: input.courseId,
    title: 'Expert Session scheduled',
    body: `${input.title} is scheduled for ${startsAt.toLocaleString()}.`,
    link: `/student/courses/${input.courseId}/sessions`,
    dedupeKey: `expert-session:${session.id}:scheduled`,
  }), 'Expert Session notification');
  return session;
}

async function managedSession(actor: Actor, sessionId: string) {
  requireManager(actor.role);
  const organizationId = tenantId(actor);
  const session = await prisma.expertSession.findFirst({
    where: {
      id: sessionId,
      organizationId,
      ...(actor.role === Role.TUTOR ? {
        course: { instructors: { some: { instructorId: actor.userId } } },
      } : {}),
    },
  });
  if (!session) throw new HttpError(404, 'Expert Session not found');
  return session;
}

export async function updateSession(actor: Actor, sessionId: string, input: {
  courseId?: string; title?: string; description?: string; startsAt?: string; durationMinutes?: number; freePreview?: boolean;
}) {
  const session = await managedSession(actor, sessionId);
  if (session.status !== ExpertSessionStatus.SCHEDULED) throw new HttpError(409, 'Only scheduled sessions can be edited');
  if (input.courseId) await canManageCourse(actor, input.courseId);
  if (input.startsAt && new Date(input.startsAt).getTime() <= Date.now()) {
    throw new HttpError(400, 'Schedule the class for a future time');
  }
  const updated = await prisma.expertSession.update({
    where: { id: session.id },
    data: {
      ...input,
      ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
    },
  });
  await prisma.auditLog.create({
    data: { organizationId: session.organizationId, actorId: actor.userId, action: 'EXPERT_SESSION_UPDATED', targetType: 'ExpertSession', targetId: session.id, metadata: { changedFields: Object.keys(input) } },
  });
  return updated;
}

export async function changeSessionStatus(actor: Actor, sessionId: string, status: 'CANCELLED' | 'LIVE') {
  const session = await managedSession(actor, sessionId);
  if (status === ExpertSessionStatus.LIVE && session.status !== ExpertSessionStatus.SCHEDULED) {
    throw new HttpError(409, 'Only a scheduled session can be started');
  }
  if (status === ExpertSessionStatus.LIVE && actor.role === Role.TUTOR) {
    const now = Date.now();
    if (now < session.startsAt.getTime() - 10 * 60_000 ||
        now > session.startsAt.getTime() + session.durationMinutes * 60_000) {
      throw new HttpError(409, 'Tutors can start a session from 10 minutes before its scheduled time until it ends');
    }
  }
  if (status === ExpertSessionStatus.CANCELLED && session.status === ExpertSessionStatus.COMPLETED) {
    throw new HttpError(409, 'Completed sessions cannot be cancelled');
  }
  const updated = await prisma.expertSession.update({ where: { id: session.id }, data: { status } });
  await prisma.auditLog.create({
    data: { organizationId: session.organizationId, actorId: actor.userId, action: status === ExpertSessionStatus.LIVE ? 'EXPERT_SESSION_STARTED' : 'EXPERT_SESSION_CANCELLED', targetType: 'ExpertSession', targetId: session.id, metadata: {} },
  });
  return updated;
}

export async function joinSession(actor: Actor, sessionId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can join as attendees');
  const organizationId = tenantId(actor);
  const session = await prisma.expertSession.findFirst({
    where: {
      id: sessionId,
      organizationId,
      status: { in: [ExpertSessionStatus.SCHEDULED, ExpertSessionStatus.LIVE] },
      OR: [
        { courseId: { in: (await prisma.enrollment.findMany({
          where: { organizationId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
          select: { courseId: true },
        })).map(({ courseId }) => courseId) } },
        { batch: { students: { some: { studentId: actor.userId, organizationId } } } },
      ],
    },
  });
  if (!session) throw new HttpError(404, 'Expert Session not found in your enrolled courses');
  await requireContentAccess({
    organizationId,
    userId: actor.userId,
    role: actor.role,
    courseId: session.courseId,
    published: true,
    freePreview: session.freePreview,
  });
  const now = new Date();
  if (now < new Date(session.startsAt.getTime() - 10 * 60_000) ||
      now > new Date(session.startsAt.getTime() + session.durationMinutes * 60_000)) {
    throw new HttpError(409, 'Joining is available from 10 minutes before the class until it ends');
  }
  const status = now.getTime() > session.startsAt.getTime() ? AttendanceMark.LATE : AttendanceMark.PRESENT;
  const attendance = await prisma.attendanceRecord.upsert({
    where: { organizationId_sessionId_studentId: { organizationId, sessionId, studentId: actor.userId } },
    create: { organizationId, sessionId, courseId: session.courseId, studentId: actor.userId, status, joinedAt: now },
    update: { joinedAt: now, status },
  });
  await prisma.auditLog.create({
    data: { organizationId, actorId: actor.userId, action: 'EXPERT_SESSION_JOINED', targetType: 'ExpertSession', targetId: session.id, metadata: { attendanceId: attendance.id } },
  });
  return { sessionId: session.id, roomName: session.roomName, roomUrl: jitsiLiveClassProvider.roomUrl(session.roomName) };
}

export async function hostSession(actor: Actor, sessionId: string) {
  const session = await managedSession(actor, sessionId);
  if (session.status !== ExpertSessionStatus.LIVE) throw new HttpError(409, 'Start the session before hosting');
  const now = Date.now();
  if (now < session.startsAt.getTime() - 10 * 60_000 ||
      now > session.startsAt.getTime() + session.durationMinutes * 60_000) {
    throw new HttpError(409, 'Hosting is available from 10 minutes before the class until it ends');
  }
  return { sessionId: session.id, roomUrl: jitsiLiveClassProvider.roomUrl(session.roomName) };
}

export async function listSessionAttendees(actor: Actor, sessionId: string) {
  const session = await managedSession(actor, sessionId);
  return prisma.enrollment.findMany({
    where: {
      organizationId: session.organizationId,
      courseId: session.courseId ?? undefined,
      status: EnrollmentStatus.ACTIVE,
      ...(actor.role === Role.TUTOR && session.courseId ? { selectedTutorId: actor.userId } : {}),
      ...(session.courseId ? {} : {
        student: {
          is: {
            studentBatches: { some: { batchId: session.batchId ?? '' } },
            ...(actor.role === Role.TUTOR ? {
              enrollments: {
                some: {
                  organizationId: session.organizationId,
                  status: EnrollmentStatus.ACTIVE,
                  selectedTutorId: actor.userId,
                  course: { instructors: { some: { organizationId: session.organizationId, instructorId: actor.userId } } },
                },
              },
            } : {}),
          },
        },
      }),
    },
    select: {
      student: {
        select: {
          id: true, name: true, studentProfile: { select: { studentId: true } },
          attendanceRecords: { where: { sessionId: session.id }, select: { status: true, joinedAt: true } },
        },
      },
    },
    orderBy: { student: { name: 'asc' } },
  });
}

export async function markAttendance(actor: Actor, sessionId: string, studentId: string, status: AttendanceMark) {
  const session = await managedSession(actor, sessionId);
  if (!session.courseId) throw new HttpError(409, 'Manual attendance requires a course session');
  if (!await canAccessCourse(session.organizationId, studentId, session.courseId, actor.role === Role.TUTOR ? actor.userId : undefined)) {
    throw new HttpError(404, 'Student is not actively enrolled in this course');
  }
  const result = await prisma.attendanceRecord.upsert({
    where: { organizationId_sessionId_studentId: { organizationId: session.organizationId, sessionId, studentId } },
    create: { organizationId: session.organizationId, sessionId, courseId: session.courseId, studentId, markedById: actor.userId, status },
    update: { markedById: actor.userId, status, markedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { organizationId: session.organizationId, actorId: actor.userId, action: 'ATTENDANCE_MARKED', targetType: 'AttendanceRecord', targetId: result.id, metadata: { sessionId, studentId, status } },
  });
  return result;
}

export async function studentAttendance(actor: Actor, courseId?: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can view their attendance');
  const organizationId = tenantId(actor);
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
    select: { courseId: true, course: { select: { id: true, code: true, title: true, minimumAttendancePercent: true } } },
  });
  const courseIds = enrollments.map(({ courseId: enrolledCourseId }) => enrolledCourseId);
  if (!courseIds.length) return { courses: [], sessions: [] };
  const sessions = await prisma.expertSession.findMany({
    where: { organizationId, courseId: { in: courseIds }, status: { not: ExpertSessionStatus.CANCELLED }, startsAt: { lte: new Date() } },
    include: { course: { select: { id: true, code: true, title: true } }, attendances: { where: { studentId: actor.userId }, select: { status: true, joinedAt: true } } },
    orderBy: { startsAt: 'desc' },
  });
  const finishedSessions = sessions.filter((session) => session.startsAt.getTime() + session.durationMinutes * 60_000 <= Date.now());
  const perCourse = enrollments.map(({ course }) => {
    const courseSessions = finishedSessions.filter((session) => session.courseId === course.id);
    const present = courseSessions.filter((session) => {
      const attendance = session.attendances[0]?.status;
      return attendance === AttendanceMark.PRESENT || attendance === AttendanceMark.LATE;
    }).length;
    const total = courseSessions.length;
    const percentage = total ? Math.round((present / total) * 100) : 0;
    return { ...course, total, present, percentage, low: total > 0 && percentage < course.minimumAttendancePercent };
  });
  return {
    courses: perCourse,
    sessions: finishedSessions.filter((session) => !courseId || session.courseId === courseId).map(({ attendances, ...session }) => ({
      ...session,
      status: attendances[0]?.status ?? AttendanceMark.ABSENT,
      joinedAt: attendances[0]?.joinedAt ?? null,
    })),
  };
}

function librarySummary(item: {
  id: string; kind: LibraryKind; category: string; title: string; description: string; published: boolean; freePreview?: boolean; createdAt: Date;
  course: { id: string; code: string; title: string } | null; savedBy: Array<{ studentId: string }>;
}) {
  return {
    id: item.id, kind: item.kind, category: item.category, title: item.title,
    description: item.description, published: item.published, freePreview: item.freePreview ?? false, createdAt: item.createdAt,
    course: item.course, saved: item.savedBy.length > 0,
  };
}

export async function listLibrary(actor: Actor, input: {
  search?: string; courseId?: string; category?: string; kind?: LibraryKind; saved?: 'true' | 'false';
}) {
  const organizationId = tenantId(actor);
  if (actor.role === Role.TUTOR && input.courseId) await canManageCourse(actor, input.courseId);
  const student = actor.role === Role.STUDENT;
  const courseIds = student
    ? (await prisma.enrollment.findMany({
      where: { organizationId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
      select: { courseId: true },
    })).map(({ courseId }) => courseId)
    : undefined;
  const tutorCourseIds = actor.role === Role.TUTOR
    ? (await prisma.courseInstructor.findMany({
      where: { organizationId, instructorId: actor.userId },
      select: { courseId: true },
    })).map(({ courseId }) => courseId)
    : undefined;
  const visibilityConditions = student
    ? [{ OR: [{ courseId: null }, { courseId: { in: courseIds } }] }]
    : actor.role === Role.TUTOR
      ? [
        { OR: [{ published: true }, { createdById: actor.userId }] },
        { OR: [{ courseId: null }, { courseId: { in: tutorCourseIds } }] },
      ]
      : [];
  const searchConditions = input.search
    ? [{
      OR: [
        { title: { contains: input.search, mode: 'insensitive' as const } },
        { description: { contains: input.search, mode: 'insensitive' as const } },
      ],
    }]
    : [];
  const items = await prisma.libraryItem.findMany({
    where: {
      organizationId, deletedAt: null,
      ...(student ? { published: true } : {}),
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(visibilityConditions.length || searchConditions.length
        ? { AND: [...visibilityConditions, ...searchConditions] }
        : {}),
      ...(student && input.saved === 'true' ? { savedBy: { some: { studentId: actor.userId } } } : {}),
      ...(student && input.saved === 'false' ? { savedBy: { none: { studentId: actor.userId } } } : {}),
    },
    include: {
      course: { select: { id: true, code: true, title: true } },
      savedBy: student ? { where: { studentId: actor.userId }, select: { studentId: true } } : false,
    },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  });
  const summaries = items.map((item) => librarySummary({ ...item, savedBy: item.savedBy ?? [] }));
  return {
    items: student
      ? await Promise.all(summaries.map(async (item) => ({
        ...item,
        locked: !await canAccessContent({
          organizationId,
          userId: actor.userId,
          role: actor.role,
          courseId: item.course?.id ?? null,
          published: item.published,
          freePreview: item.freePreview,
        }),
      })))
      : summaries,
  };
}

async function canAccessLibraryItem(actor: Actor, itemId: string) {
  const organizationId = tenantId(actor);
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, organizationId, deletedAt: null },
    include: { course: { select: { id: true, code: true, title: true } }, savedBy: { where: { studentId: actor.userId }, select: { studentId: true } } },
  });
  if (!item) throw new HttpError(404, 'Library item not found');
  if (actor.role === Role.STUDENT && (!item.published ||
      (item.courseId !== null && !await canAccessCourse(organizationId, actor.userId, item.courseId)))) {
    throw new HttpError(404, 'Library item not found in your enrolled courses');
  }
  if (actor.role === Role.TUTOR && item.courseId) await canManageCourse(actor, item.courseId);
  await requireContentAccess({
    organizationId,
    userId: actor.userId,
    role: actor.role,
    courseId: item.courseId,
    published: item.published,
    freePreview: item.freePreview,
  });
  if (actor.role === Role.TUTOR && !item.published && item.createdById !== actor.userId) {
    throw new HttpError(404, 'Library item not found');
  }
  return item;
}

export async function createLibraryItem(actor: Actor, input: {
  courseId?: string | null; kind: LibraryKind; category: string; title: string; description: string; contentText?: string; externalUrl?: string; freePreview?: boolean;
}, file?: Express.Multer.File) {
  requireManager(actor.role);
  const organizationId = tenantId(actor);
  if (input.courseId) await canManageCourse(actor, input.courseId);
  if ((input.kind === LibraryKind.BOOK || input.kind === LibraryKind.DOCUMENT) && !file) {
    throw new HttpError(400, 'Upload a PDF for books and documents');
  }
  if (input.kind !== LibraryKind.LINK && !file && !input.contentText) {
    throw new HttpError(400, 'Add readable content or upload a PDF');
  }
  if (file) {
    const extension = extname(file.originalname).toLowerCase();
    if (extension !== '.pdf' || file.mimetype.toLowerCase() !== 'application/pdf' ||
        file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpError(400, 'Library attachments must be valid PDF files');
    }
    if (file.size > maxLibraryFileBytes) throw new HttpError(413, 'Library PDFs must be 20 MB or smaller');
  }
  const originalName = file
    ? basename(file.originalname.replaceAll('\\', '/')).replace(/[\r\n"]/g, '').slice(0, 255)
    : null;
  if (file && !originalName) throw new HttpError(400, 'The uploaded PDF must have a valid filename');
  const storageKey = file ? await localDiskStorage.save(file.buffer, '.pdf') : null;
  try {
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.libraryItem.create({
        data: {
          ...input,
          organizationId,
          createdById: actor.userId,
          courseId: input.courseId ?? null,
          contentText: file ? null : input.contentText ?? null,
          storageKey,
          originalName,
          mimeType: file ? 'application/pdf' : null,
        },
        include: { course: { select: { id: true, code: true, title: true } }, savedBy: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: actor.userId,
          action: 'LIBRARY_ITEM_CREATED',
          targetType: 'LibraryItem',
          targetId: created.id,
          metadata: { kind: input.kind, category: input.category, hasFile: Boolean(file) },
        },
      });
      return created;
    });
    return librarySummary(item);
  } catch (error) {
    if (storageKey) {
      try {
        await localDiskStorage.remove(storageKey);
      } catch (cleanupError) {
        logger.error({ err: cleanupError, storageKey }, 'Unable to remove an unreferenced Library PDF');
      }
    }
    throw error;
  }
}

export async function updateLibraryItem(actor: Actor, itemId: string, input: { published?: boolean; freePreview?: boolean; title?: string; description?: string }) {
  requireManager(actor.role);
  const organizationId = tenantId(actor);
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, organizationId, deletedAt: null, ...(actor.role === Role.TUTOR ? { createdById: actor.userId } : {}) },
    select: { id: true, courseId: true },
  });
  if (!item) throw new HttpError(404, 'Library item not found');
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.libraryItem.update({
      where: { id: item.id },
      data: input,
      include: { course: { select: { id: true, code: true, title: true } }, savedBy: true },
    });
    await tx.auditLog.create({
      data: { organizationId, actorId: actor.userId, action: input.published === undefined ? 'LIBRARY_ITEM_UPDATED' : input.published ? 'LIBRARY_ITEM_PUBLISHED' : 'LIBRARY_ITEM_UNPUBLISHED', targetType: 'LibraryItem', targetId: item.id, metadata: { changedFields: Object.keys(input) } },
    });
    return result;
  });
  if (input.published && item.courseId) {
    const courseId = item.courseId;
    await notifyAfterCommit(() => notifyCourseStudents(organizationId, courseId, {
      type: NotificationType.CONTENT_PUBLISHED, courseId, title: 'New library item',
      body: `${updated.title} is available in the Library.`, link: '/student/library',
      dedupeKey: `library-item:${item.id}:published`,
    }), 'Library publication notification');
  }
  return librarySummary(updated);
}

export async function deleteLibraryItem(actor: Actor, itemId: string) {
  requireManager(actor.role);
  const organizationId = tenantId(actor);
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, organizationId, deletedAt: null, ...(actor.role === Role.TUTOR ? { createdById: actor.userId } : {}) },
    select: { id: true },
  });
  if (!item) throw new HttpError(404, 'Library item not found');
  await prisma.$transaction(async (tx) => {
    await tx.libraryItem.update({ where: { id: item.id }, data: { deletedAt: new Date(), published: false } });
    await tx.auditLog.create({
      data: { organizationId, actorId: actor.userId, action: 'LIBRARY_ITEM_DELETED', targetType: 'LibraryItem', targetId: item.id, metadata: { softDelete: true } },
    });
  });
}

export async function getLibraryItem(actor: Actor, itemId: string) {
  const item = await canAccessLibraryItem(actor, itemId);
  return {
    ...librarySummary(item),
    contentText: item.contentText,
    externalUrl: item.externalUrl,
    hasDocument: Boolean(item.storageKey),
    documentName: item.originalName,
  };
}

export async function viewLibraryContent(actor: Actor, itemId: string) {
  const item = await canAccessLibraryItem(actor, itemId);
  if (!item.storageKey || item.mimeType !== 'application/pdf' || !item.originalName) {
    throw new HttpError(404, 'Library document not found');
  }
  if (actor.role === Role.STUDENT) {
    await prisma.auditLog.create({
      data: {
        organizationId: tenantId(actor),
        actorId: actor.userId,
        action: 'LIBRARY_ITEM_VIEWED',
        targetType: 'LibraryItem',
        targetId: item.id,
        metadata: { kind: item.kind },
      },
    });
  }
  return {
    item: { id: item.id, originalName: item.originalName, mimeType: item.mimeType },
    file: await localDiskStorage.open(item.storageKey),
  };
}

export async function saveLibraryItem(actor: Actor, itemId: string, saved: boolean) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can save Library items');
  const organizationId = tenantId(actor);
  await canAccessLibraryItem(actor, itemId);
  if (saved) {
    await prisma.savedLibraryItem.upsert({
      where: { organizationId_itemId_studentId: { organizationId, itemId, studentId: actor.userId } },
      create: { organizationId, itemId, studentId: actor.userId },
      update: {},
    });
  } else {
    await prisma.savedLibraryItem.deleteMany({ where: { organizationId, itemId, studentId: actor.userId } });
  }
  return { itemId, saved };
}

export async function studentCertificates(actor: Actor) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can view certificates');
  const certificates = await prisma.certificate.findMany({
    where: { organizationId: tenantId(actor), studentId: actor.userId },
    select: {
      id: true, certificateNo: true, verificationCode: true, issuedAt: true, issuedStudentName: true,
      student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
      course: { select: { title: true, code: true } },
      organization: { select: { name: true } },
    },
    orderBy: { issuedAt: 'desc' },
  });
  return certificates.map(({ issuedStudentName, student, ...certificate }) => ({
    ...certificate,
    student: { ...student, name: issuedStudentName ?? student.name },
  }));
}

export async function publicCertificate(verificationCode: string) {
  const certificate = await prisma.certificate.findUnique({
    where: { verificationCode },
    select: {
      certificateNo: true, issuedAt: true, issuedStudentName: true,
      student: { select: { name: true } },
      course: { select: { title: true, code: true } },
      organization: { select: { name: true } },
    },
  });
  if (!certificate) throw new HttpError(404, 'Certificate could not be verified');
  const { issuedStudentName, student, ...details } = certificate;
  return { ...details, student: { name: issuedStudentName ?? student.name } };
}

export async function studentKnowledge(actor: Actor) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can view learning progress');
  const organizationId = tenantId(actor);
  const [attempts, practice, ratings, media] = await prisma.$transaction([
    prisma.assessmentAttempt.findMany({
      where: { organizationId, studentId: actor.userId, status: { in: ['SUBMITTED', 'EXPIRED'] } },
      select: { id: true, score: true, percentage: true, passed: true, submittedAt: true, assessment: { select: { title: true, course: { select: { title: true, code: true } } } } },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    }),
    prisma.practiceSession.findMany({
      where: { organizationId, studentId: actor.userId },
      select: { id: true, score: true, totalQuestions: true, answeredCount: true, status: true, createdAt: true, course: { select: { title: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.gameRating.findMany({ where: { organizationId, studentId: actor.userId }, select: { gameKey: true, rating: true } }),
    prisma.watchProgress.findMany({
      where: { organizationId, studentId: actor.userId },
      select: { completed: true, media: { select: { title: true, course: { select: { title: true } } } } },
    }),
  ]);
  return {
    attempts,
    practice,
    ratings,
    media: { completed: media.filter((item) => item.completed).length, total: media.length },
  };
}

export async function studentReports(actor: Actor) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can view their reports');
  const organizationId = tenantId(actor);
  const attempts = await prisma.assessmentAttempt.findMany({
    where: {
      organizationId,
      studentId: actor.userId,
      status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.EXPIRED] },
      submittedAt: { not: null },
      score: { not: null },
      assessment: {
        OR: [
          { resultReleaseMode: ResultReleaseMode.IMMEDIATE },
          { resultsReleasedAt: { not: null } },
        ],
      },
    },
    select: {
      score: true,
      submittedAt: true,
      assessment: {
        select: {
          totalMarks: true,
          course: { select: { title: true } },
        },
      },
    },
    orderBy: { submittedAt: 'asc' },
  });
  return {
    studentReports: attempts.flatMap((attempt) => {
      if (attempt.score === null || attempt.submittedAt === null) return [];
      const { totalMarks, course } = attempt.assessment;
      return [{
        date: attempt.submittedAt,
        subject: course.title,
        marks: attempt.score,
        totalMarks,
        percentage: totalMarks > 0 ? (attempt.score / totalMarks) * 100 : 0,
      }];
    }),
  };
}

export async function rateKnowledgeGame(actor: Actor, input: { gameKey: string; rating: number }) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can rate learning games');
  const organizationId = tenantId(actor);
  const rating = await prisma.gameRating.upsert({
    where: { organizationId_studentId_gameKey: { organizationId, studentId: actor.userId, gameKey: input.gameKey } },
    create: { organizationId, studentId: actor.userId, gameKey: input.gameKey, rating: input.rating },
    update: { rating: input.rating },
  });
  return { gameKey: rating.gameKey, rating: rating.rating };
}

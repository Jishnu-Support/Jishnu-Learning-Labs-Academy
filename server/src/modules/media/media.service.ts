import { EnrollmentStatus, MediaJobStatus, MediaSource, MediaStatus, MediaType, MediaVisibility, NotificationType, Prisma, Role } from '@prisma/client';
import { fileTypeFromFile } from 'file-type';
import { basename, extname } from 'node:path';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { mediaStorage } from './media.storage.js';
import { notifyAfterCommit, notifyCourseStudents } from '../notifications/notifications.service.js';
import { assertActiveCourseEnrollment, canAccessContent, requireContentAccess } from '../student-portal/content-access.service.js';
import { tryIssueStudentCertificate } from '../student-portal/student-portal.service.js';
import type { CreateMediaInput, MediaListInput, UpdateMediaInput } from './media.schemas.js';
import { expectedMediaMimeTypes, youtubeVideoIdFromUrl } from './media.schemas.js';

const managerRoles = [Role.TUTOR, Role.ORG_ADMIN, Role.SUPER_ADMIN] as const;
const videoLimits = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const audioLimits = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg']);

type MediaActor = { organizationId: string | null; userId: string; role: Role };

function tenantId(actor: MediaActor): string {
  if (!actor.organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return actor.organizationId;
}

function assertMediaManager(role: Role): void {
  if (!managerRoles.includes(role as typeof managerRoles[number])) {
    throw new HttpError(403, 'You do not have permission to manage media');
  }
}

function fileLimitBytes(type: MediaType): number {
  return (type === MediaType.VIDEO ? env.MAX_VIDEO_MB : env.MAX_AUDIO_MB) * 1024 * 1024;
}

function storageQuotaBytes(): bigint {
  return BigInt(Math.floor(env.MEDIA_STORAGE_QUOTA_GB * 1024 ** 3));
}

async function validateCourseAndTopic(
  organizationId: string,
  userId: string,
  role: Role,
  courseId: string,
  topicId?: string | null,
) {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId,
      ...(role === Role.TUTOR ? { instructors: { some: { instructorId: userId } } } : {}),
    },
    select: { id: true },
  });
  if (!course) throw new HttpError(404, 'Course not found in your organization');
  if (!topicId) return;
  const topic = await prisma.courseTopic.findFirst({
    where: { id: topicId, organizationId, courseId },
    select: { id: true },
  });
  if (!topic) throw new HttpError(404, 'Topic not found in the selected course');
}

function mediaWhere(actor: MediaActor, mediaId: string): Prisma.MediaItemWhereInput {
  const organizationId = tenantId(actor);
  return {
    organizationId,
    id: mediaId,
    deletedAt: null,
    ...(actor.role === Role.ORG_ADMIN || actor.role === Role.SUPER_ADMIN ? {} : { uploadedById: actor.userId }),
  };
}

async function findManagedMedia(actor: MediaActor, mediaId: string) {
  assertMediaManager(actor.role);
  const media = await prisma.mediaItem.findFirst({
    where: mediaWhere(actor, mediaId),
    include: { course: { select: { id: true, title: true, code: true } }, topic: { select: { id: true, title: true } } },
  });
  if (!media) throw new HttpError(404, 'Media not found');
  return media;
}

async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({
    data: { organizationId, actorId, action, targetType: 'MediaItem', targetId, metadata },
  });
}

function serializeMedia<T extends { sizeBytes: bigint; storageBytes: bigint }>(media: T) {
  return { ...media, sizeBytes: Number(media.sizeBytes), storageBytes: Number(media.storageBytes) };
}

function serializeStudentMedia<T extends {
  id: string;
  title: string;
  description: string | null;
  type: MediaType;
  source: MediaSource;
  youtubeVideoId: string | null;
  watchProgress: Array<{ lastPositionSeconds: number; watchedSeconds: number; completed: boolean }>;
  durationSeconds: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  thumbnailKey: string | null;
  course: { id: string; title: string; code: string };
  topic: { id: string; title: string } | null;
}>(media: T) {
  const progress = media.watchProgress[0] ?? null;
  const positionSeconds = progress?.lastPositionSeconds ?? 0;
  const durationSeconds = media.durationSeconds ?? 0;
  const progressPercent = durationSeconds > 0 ? Math.min(100, (positionSeconds / durationSeconds) * 100) : 0;
  return {
    id: media.id,
    title: media.title,
    description: media.description,
    type: media.type,
    source: media.source,
    youtubeVideoId: media.youtubeVideoId,
    durationSeconds: media.durationSeconds,
    createdAt: media.createdAt,
    publishedAt: media.publishedAt,
    thumbnailUrl: media.thumbnailKey ? `/student/media/${media.id}/stream/thumbnail.jpg` : null,
    course: media.course,
    topic: media.topic,
    watchProgress: progress,
    progressPercent,
    completed: progress?.completed ?? false,
  };
}

async function activeStudentCourseIds(organizationId: string, studentId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationId, studentId, status: EnrollmentStatus.ACTIVE },
    select: { courseId: true },
  });
  return enrollments.map((item) => item.courseId);
}

export async function listStudentMedia(actor: MediaActor, filters: { courseId?: string; type?: MediaType; search?: string }) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can browse published media');
  const organizationId = tenantId(actor);
  if (filters.courseId) await assertActiveCourseEnrollment(organizationId, actor.userId, filters.courseId);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  if (courseIds.length === 0) return { items: [], courses: [] };

  const items = await prisma.mediaItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      courseId: { in: courseIds },
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.search ? {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
          { course: { title: { contains: filters.search, mode: 'insensitive' } } },
          { topic: { title: { contains: filters.search, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: {
      course: { select: { id: true, title: true, code: true } },
      topic: { select: { id: true, title: true } },
      watchProgress: { where: { studentId: actor.userId }, select: { lastPositionSeconds: true, watchedSeconds: true, completed: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ course: { title: 'asc' } }, { topic: { title: 'asc' } }, { createdAt: 'desc' }],
  });

  const courses = await prisma.course.findMany({
    where: { organizationId, id: { in: courseIds } },
    select: { id: true, title: true, code: true },
    orderBy: { title: 'asc' },
  });

  return {
    items: await Promise.all(items.map(async (item) => ({
      ...serializeStudentMedia(item),
      locked: !await canAccessContent({
        organizationId,
        userId: actor.userId,
        role: actor.role,
        courseId: item.courseId,
        published: true,
        freePreview: item.freePreview,
      }),
    }))),
    courses,
  };
}

export async function getStudentMedia(actor: MediaActor, mediaId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can open published media');
  const organizationId = tenantId(actor);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  const media = await prisma.mediaItem.findFirst({
    where: {
      organizationId,
      id: mediaId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      courseId: { in: courseIds },
    },
    include: {
      course: { select: { id: true, title: true, code: true } },
      topic: { select: { id: true, title: true } },
      watchProgress: { where: { studentId: actor.userId }, select: { lastPositionSeconds: true, watchedSeconds: true, completed: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
  });
  if (!media) throw new HttpError(404, 'Media not found in your enrolled courses');
  await requireContentAccess({
    organizationId, userId: actor.userId, role: actor.role, courseId: media.courseId,
    published: true, freePreview: media.freePreview,
  });
  return serializeStudentMedia(media);
}

export async function recordWatchProgress(actor: MediaActor, mediaId: string, input: { positionSeconds: number; watchedSeconds: number; completed: boolean }) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can update watch progress');
  const organizationId = tenantId(actor);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  const media = await prisma.mediaItem.findFirst({
    where: {
      organizationId,
      id: mediaId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      courseId: { in: courseIds },
    },
    select: { id: true, durationSeconds: true, courseId: true, freePreview: true },
  });
  if (!media) throw new HttpError(404, 'Media not found in your enrolled courses');
  await requireContentAccess({
    organizationId, userId: actor.userId, role: actor.role, courseId: media.courseId,
    published: true, freePreview: media.freePreview,
  });

  const previous = await prisma.watchProgress.findUnique({
    where: { organizationId_studentId_mediaId: { organizationId, studentId: actor.userId, mediaId } },
    select: { lastPositionSeconds: true, watchedSeconds: true, completed: true, updatedAt: true },
  });
  const now = new Date();
  const durationSeconds = media.durationSeconds;
  const positionSeconds = Math.max(0, durationSeconds === null
    ? input.positionSeconds
    : Math.min(input.positionSeconds, durationSeconds));
  const elapsedSeconds = previous ? Math.max(0, (now.getTime() - previous.updatedAt.getTime()) / 1000) : 0;
  const positionDelta = previous
    ? Math.max(0, positionSeconds - previous.lastPositionSeconds)
    : positionSeconds;
  const watchedSeconds = (previous?.watchedSeconds ?? 0) + Math.min(positionDelta, Math.max(5, elapsedSeconds * 1.5));
  const completed = Boolean(previous?.completed || (
    durationSeconds !== null && durationSeconds > 0 && watchedSeconds >= durationSeconds * 0.9
  ));
  const progress = await prisma.watchProgress.upsert({
    where: { organizationId_studentId_mediaId: { organizationId, studentId: actor.userId, mediaId } },
    create: {
      organizationId,
      studentId: actor.userId,
      mediaId,
      lastPositionSeconds: positionSeconds,
      watchedSeconds,
      completed,
    },
    update: {
      lastPositionSeconds: positionSeconds,
      watchedSeconds,
      completed,
    },
  });
  if (progress.completed) await tryIssueStudentCertificate(organizationId, actor.userId, media.courseId);
  return { id: media.id, progress };
}

export async function previewStudentAsset(actor: MediaActor, mediaId: string, assetPath: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can preview media');
  const organizationId = tenantId(actor);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  const media = await prisma.mediaItem.findFirst({
    where: {
      organizationId,
      id: mediaId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      courseId: { in: courseIds },
    },
    select: { id: true, organizationId: true, streamKey: true, type: true, title: true, courseId: true, freePreview: true },
  });
  if (!media || !media.streamKey) throw new HttpError(404, 'Media preview not found');
  await requireContentAccess({
    organizationId, userId: actor.userId, role: actor.role, courseId: media.courseId,
    published: true, freePreview: media.freePreview,
  });

  const safeAsset = assetPath.split('/').filter(Boolean);
  if (safeAsset.some((part) => part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part)) || safeAsset.includes('enc.key')) {
    throw new HttpError(404, 'Media file not found');
  }

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: actor.userId,
      action: 'MEDIA_VIEWED',
      targetType: 'MediaItem',
      targetId: media.id,
      metadata: { assetPath, type: media.type, title: media.title, suspicious: false },
    },
  });

  const key = `${media.streamKey}/${safeAsset.join('/')}`;
  return { media, file: await mediaStorage.open(key.startsWith('processed/') ? key : `processed/${key}`) };
}

function parseByteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || size === 0 || (!match[1] && !match[2])) return null;
  const startValue = match[1] ? Number(match[1]) : null;
  const endValue = match[2] ? Number(match[2]) : null;
  if (startValue === null) {
    if (endValue === null || !Number.isSafeInteger(endValue) || endValue <= 0) return null;
    return { start: Math.max(0, size - endValue), end: size - 1 };
  }
  if (!Number.isSafeInteger(startValue) || startValue < 0 || startValue >= size) return null;
  const end = endValue ?? size - 1;
  if (!Number.isSafeInteger(end) || end < startValue) return null;
  return { start: startValue, end: Math.min(end, size - 1) };
}

export async function streamStudentProgressiveMp4(actor: MediaActor, mediaId: string, rangeHeader?: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can preview media');
  const organizationId = tenantId(actor);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  const media = await prisma.mediaItem.findFirst({
    where: {
      id: mediaId,
      organizationId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      type: MediaType.VIDEO,
      courseId: { in: courseIds },
    },
    select: { id: true, originalKey: true, title: true, type: true, courseId: true, freePreview: true },
  });
  if (!media?.originalKey || extname(media.originalKey).toLowerCase() !== '.mp4') {
    throw new HttpError(404, 'Progressive MP4 playback is not available');
  }
  await requireContentAccess({
    organizationId, userId: actor.userId, role: actor.role, courseId: media.courseId,
    published: true, freePreview: media.freePreview,
  });

  const file = await mediaStorage.open(media.originalKey);
  if (!rangeHeader) {
    await prisma.auditLog.create({
      data: { organizationId, actorId: actor.userId, action: 'MEDIA_VIEWED', targetType: 'MediaItem', targetId: media.id, metadata: { source: 'progressive-mp4', title: media.title } },
    });
    return { file, range: null, unsatisfiable: false as const };
  }

  const range = parseByteRange(rangeHeader, file.size);
  if (!range) {
    file.stream.destroy();
    return { size: file.size, unsatisfiable: true as const };
  }
  file.stream.destroy();
  const rangedFile = await mediaStorage.open(media.originalKey, range);
  await prisma.auditLog.create({
    data: { organizationId, actorId: actor.userId, action: 'MEDIA_VIEWED', targetType: 'MediaItem', targetId: media.id, metadata: { source: 'progressive-mp4', title: media.title } },
  });
  return { file: rangedFile, range: { ...range, size: file.size }, unsatisfiable: false as const };
}

export async function listMedia(actor: MediaActor, filters: MediaListInput) {
  assertMediaManager(actor.role);
  const organizationId = tenantId(actor);
  const media = await prisma.mediaItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(actor.role === Role.ORG_ADMIN || actor.role === Role.SUPER_ADMIN ? {} : { uploadedById: actor.userId }),
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.visibility ? { visibility: filters.visibility } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    },
    include: {
      course: { select: { id: true, title: true, code: true } },
      topic: { select: { id: true, title: true } },
      uploadedBy: { select: { id: true, name: true, role: true } },
      uploadedBySuperAdmin: { select: { id: true, name: true, role: true } },
      job: { select: { status: true, attempts: true, progressPercent: true, error: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const aggregate = await prisma.mediaItem.aggregate({
    where: { organizationId },
    _sum: { storageBytes: true },
  });
  const storage = actor.role === Role.ORG_ADMIN || actor.role === Role.SUPER_ADMIN ? {
    usedBytes: Number(aggregate._sum.storageBytes ?? 0n),
    quotaBytes: Number(storageQuotaBytes()),
    quotaGigabytes: env.MEDIA_STORAGE_QUOTA_GB,
  } : null;
  return {
    media: media.map(({ uploadedBy, uploadedBySuperAdmin, ...item }) => serializeMedia({
      ...item,
      uploadedBy: uploadedBy ?? uploadedBySuperAdmin,
    })),
    storage,
  };
}

export async function listMediaCourses(actor: MediaActor) {
  assertMediaManager(actor.role);
  const organizationId = tenantId(actor);
  return prisma.course.findMany({
    where: {
      organizationId,
      ...(actor.role === Role.TUTOR ? { instructors: { some: { instructorId: actor.userId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      code: true,
      topics: { select: { id: true, title: true, order: true }, orderBy: { order: 'asc' } },
    },
    orderBy: { title: 'asc' },
  });
}

export async function createMedia(actor: MediaActor, input: CreateMediaInput) {
  assertMediaManager(actor.role);
  const organizationId = tenantId(actor);
  await validateCourseAndTopic(organizationId, actor.userId, actor.role, input.courseId, input.topicId);

  if (input.source === MediaSource.YOUTUBE) {
    const youtubeVideoId = youtubeVideoIdFromUrl(input.youtubeUrl ?? '');
    if (!youtubeVideoId) throw new HttpError(400, 'Enter a valid YouTube video URL');
    if (input.type !== MediaType.VIDEO) throw new HttpError(400, 'YouTube links can only be used for video media');
    const media = await prisma.$transaction(async (tx) => {
      const created = await tx.mediaItem.create({
        data: {
          organizationId,
          uploadedById: actor.role === Role.SUPER_ADMIN ? null : actor.userId,
          uploadedBySuperAdminId: actor.role === Role.SUPER_ADMIN ? actor.userId : null,
          courseId: input.courseId,
          topicId: input.topicId ?? null,
          title: input.title,
          description: input.description,
          type: MediaType.VIDEO,
          source: MediaSource.YOUTUBE,
          youtubeVideoId,
          status: MediaStatus.READY,
          visibility: MediaVisibility.DRAFT,
          freePreview: input.freePreview,
          sizeBytes: 0n,
          storageBytes: 0n,
        },
      });
      await audit(tx, organizationId, actor.userId, 'MEDIA_YOUTUBE_LINKED', created.id, {
        courseId: input.courseId,
        youtubeVideoId,
      });
      return created;
    });
    if (input.publishOnReady) return setMediaVisibility(actor, media.id, true);
    return serializeMedia(media);
  }

  const hasFile = Boolean(input.fileName && input.extension && input.sizeBytes && input.mimeType);

  if (hasFile) {
    const extension = input.extension!.toLowerCase();
    const fileNameExtension = extname(basename(input.fileName!.replaceAll('\\', '/'))).toLowerCase();
    if (fileNameExtension !== extension) throw new HttpError(400, 'File name extension does not match the selected type');
    if ((input.type === MediaType.VIDEO && !videoLimits.has(extension)) ||
      (input.type === MediaType.AUDIO && !audioLimits.has(extension))) {
      throw new HttpError(400, 'Unsupported file extension for this media type');
    }
    if (input.sizeBytes! > fileLimitBytes(input.type)) {
      throw new HttpError(413, `Files of this type may not exceed ${input.type === MediaType.VIDEO ? env.MAX_VIDEO_MB : env.MAX_AUDIO_MB} MB`);
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.mediaItem.aggregate({
        where: { organizationId },
        _sum: { storageBytes: true },
      });
      const usedBytes = current._sum.storageBytes ?? 0n;
      const requestedBytes = BigInt(input.sizeBytes ?? 0);
      if (hasFile && usedBytes + requestedBytes > storageQuotaBytes()) {
        throw new HttpError(413, 'Organization media storage quota would be exceeded');
      }
      const mediaStatus = hasFile ? MediaStatus.UPLOADING : MediaStatus.AWAITING_FILE;
      const media = await tx.mediaItem.create({
        data: {
          organizationId,
          uploadedById: actor.role === Role.SUPER_ADMIN ? null : actor.userId,
          uploadedBySuperAdminId: actor.role === Role.SUPER_ADMIN ? actor.userId : null,
          courseId: input.courseId,
          topicId: input.topicId ?? null,
          title: input.title,
          description: input.description,
          freePreview: input.freePreview,
          type: input.type,
          status: mediaStatus,
          visibility: MediaVisibility.DRAFT,
          sizeBytes: requestedBytes,
          storageBytes: requestedBytes,
          publishOnReady: Boolean(input.publishOnReady),
        },
      });
      await audit(tx, organizationId, actor.userId, 'MEDIA_UPLOAD_STARTED', media.id, {
        type: media.type,
        courseId: media.courseId,
        sizeBytes: input.sizeBytes ?? 0,
        status: mediaStatus,
        publishOnReady: Boolean(input.publishOnReady),
      });
      return serializeMedia(media);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new HttpError(409, 'Storage quota changed during upload setup. Please try again.');
    }
    throw error;
  }
}

export async function acceptUpload(
  actor: MediaActor,
  mediaId: string,
  request: NodeJS.ReadableStream,
  contentLength: number | undefined,
  contentType: string | undefined,
  extension: string,
) {
  const media = await findManagedMedia(actor, mediaId);
  if (media.status !== MediaStatus.UPLOADING && media.status !== MediaStatus.AWAITING_FILE) {
    throw new HttpError(409, 'This media item is not waiting for an upload');
  }
  if (media.sizeBytes > BigInt(fileLimitBytes(media.type))) {
    throw new HttpError(413, 'The upload exceeds the configured size limit');
  }
  const declaredBytes = Number(media.sizeBytes);
  const maximumBytes = declaredBytes || fileLimitBytes(media.type);
  if (contentLength !== undefined && (
    !Number.isSafeInteger(contentLength)
    || contentLength <= 0
    || contentLength > fileLimitBytes(media.type)
    || (declaredBytes > 0 && contentLength !== declaredBytes)
  )) {
    throw new HttpError(400, 'Upload content length does not match the declared file size');
  }
  const normalizedExtension = extension.toLowerCase();
  const claimedType = contentType?.toLowerCase().split(';')[0]?.trim();
  if (!expectedMediaMimeTypes(media.type, normalizedExtension).includes(claimedType ?? '')) {
    throw new HttpError(400, 'Upload MIME type does not match the declared file type');
  }
  const tempFile = await mediaStorage.createIncomingFile();
  try {
    const size = await mediaStorage.writeIncoming(request, tempFile.path, maximumBytes);
    if (size <= 0 || size > fileLimitBytes(media.type) || (declaredBytes > 0 && size !== declaredBytes)) {
      throw new HttpError(400, 'Uploaded file size does not match the declared file size');
    }
    const detected = await fileTypeFromFile(tempFile.path);
    if (!detected || !expectedMediaMimeTypes(media.type, normalizedExtension).includes(detected.mime)) {
      throw new HttpError(400, 'File contents do not match the selected extension and media type');
    }
    const originalKey = await mediaStorage.adoptIncoming(tempFile.path, media.organizationId, media.id, normalizedExtension);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const currentUsage = await tx.mediaItem.aggregate({
          where: { organizationId: media.organizationId, id: { not: media.id } },
          _sum: { storageBytes: true },
        });
        if ((currentUsage._sum.storageBytes ?? 0n) + BigInt(size) > storageQuotaBytes()) {
          throw new HttpError(413, 'Organization media storage quota would be exceeded');
        }
        const updated = await tx.mediaItem.updateMany({
          where: {
            id: media.id,
            organizationId: media.organizationId,
            status: { in: [MediaStatus.UPLOADING, MediaStatus.AWAITING_FILE] },
            deletedAt: null,
          },
          data: { status: MediaStatus.PROCESSING, originalKey, sizeBytes: BigInt(size), storageBytes: BigInt(size) },
        });
        if (updated.count !== 1) throw new HttpError(409, 'Media upload was cancelled or changed');
        await tx.mediaJob.create({
          data: { organizationId: media.organizationId, mediaId: media.id, status: MediaJobStatus.QUEUED },
        });
        await audit(tx, media.organizationId, actor.userId, 'MEDIA_UPLOADED', media.id, { sizeBytes: size });
        return tx.mediaItem.findFirstOrThrow({
          where: { id: media.id, organizationId: media.organizationId },
          include: { course: { select: { id: true, title: true, code: true } }, topic: { select: { id: true, title: true } } },
        });
      });
      return serializeMedia(result);
    } catch (error) {
      await mediaStorage.removeKey(originalKey);
      throw error;
    }
  } catch (error) {
    await mediaStorage.removeIncoming(tempFile.path);
    if (error instanceof HttpError) throw error;
    throw error;
  }
}

export async function updateMedia(actor: MediaActor, mediaId: string, input: UpdateMediaInput) {
  const media = await findManagedMedia(actor, mediaId);
  await validateCourseAndTopic(media.organizationId, actor.userId, actor.role, input.courseId, input.topicId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mediaItem.update({
      where: { id: media.id },
      data: { title: input.title, description: input.description, courseId: input.courseId, topicId: input.topicId, freePreview: input.freePreview },
      include: { course: { select: { id: true, title: true, code: true } }, topic: { select: { id: true, title: true } } },
    });
    await audit(tx, media.organizationId, actor.userId, 'MEDIA_UPDATED', media.id, {
      courseId: input.courseId,
      topicId: input.topicId,
    });
    return serializeMedia(updated);
  });
}

export async function setMediaVisibility(actor: MediaActor, mediaId: string, published: boolean) {
  const media = await findManagedMedia(actor, mediaId);
  if (published && media.status !== MediaStatus.READY) throw new HttpError(409, 'Media must be ready before it can be published');
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.mediaItem.update({
      where: { id: media.id },
      data: {
        visibility: published ? MediaVisibility.PUBLISHED : MediaVisibility.DRAFT,
        publishedAt: published ? new Date() : null,
      },
    });
    await audit(tx, media.organizationId, actor.userId, published ? 'MEDIA_PUBLISHED' : 'MEDIA_UNPUBLISHED', media.id);
    return serializeMedia(updated);
  });
  if (published && media.courseId) {
    const courseId = media.courseId;
    await notifyAfterCommit(() => notifyCourseStudents(tenantId(actor), courseId, {
      type: NotificationType.CONTENT_PUBLISHED,
      title: 'New learning content',
      body: `${media.title} is now available.`,
      link: `/student/courses/${courseId}/media`,
      groupKey: `course:${courseId}:content`,
      dedupeKey: `media:${media.id}:published`,
    }), 'media publication');
  }
  return updated;
}

export async function softDeleteMedia(actor: MediaActor, mediaId: string) {
  const media = await findManagedMedia(actor, mediaId);
  await prisma.$transaction(async (tx) => {
    await tx.mediaItem.update({ where: { id: media.id }, data: { deletedAt: new Date(), visibility: MediaVisibility.DRAFT, publishedAt: null } });
    await audit(tx, media.organizationId, actor.userId, 'MEDIA_DELETED', media.id, { softDelete: true });
  });
}

export async function cancelUpload(actor: MediaActor, mediaId: string) {
  const media = await findManagedMedia(actor, mediaId);
  if (media.status !== MediaStatus.UPLOADING && media.status !== MediaStatus.AWAITING_FILE) {
    throw new HttpError(409, 'Only an upload in progress or an empty draft can be cancelled');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.mediaItem.updateMany({
      where: {
        id: media.id,
        organizationId: media.organizationId,
        status: { in: [MediaStatus.UPLOADING, MediaStatus.AWAITING_FILE] },
        deletedAt: null,
      },
      data: { deletedAt: new Date(), storageBytes: 0n, visibility: MediaVisibility.DRAFT, publishOnReady: false },
    });
    if (updated.count !== 1) throw new HttpError(409, 'The upload changed before cancellation completed');
    await audit(tx, media.organizationId, actor.userId, 'MEDIA_UPLOAD_CANCELLED', media.id);
  });
}

export async function retryProcessing(actor: MediaActor, mediaId: string) {
  const media = await findManagedMedia(actor, mediaId);
  if (media.status !== MediaStatus.FAILED || !media.originalKey) throw new HttpError(409, 'Only failed media with an uploaded original can be retried');
  return prisma.$transaction(async (tx) => {
    await tx.mediaItem.update({ where: { id: media.id }, data: { status: MediaStatus.PROCESSING } });
    await tx.mediaJob.update({
      where: { organizationId_mediaId: { organizationId: media.organizationId, mediaId: media.id } },
      data: {
        status: MediaJobStatus.QUEUED,
        attempts: 0,
        error: null,
        progressPercent: 0,
        finishedAt: null,
        availableAt: new Date(),
      },
    });
    await audit(tx, media.organizationId, actor.userId, 'MEDIA_PROCESSING_RETRY', media.id);
    return { id: media.id, status: MediaStatus.PROCESSING };
  });
}

export async function authorizePreview(actor: MediaActor, mediaId: string) {
  const media = await findManagedMedia(actor, mediaId);
  if (media.status !== MediaStatus.READY || !media.streamKey) throw new HttpError(404, 'Media preview not found');
  return media;
}

export async function previewAsset(actor: MediaActor, mediaId: string, assetPath: string) {
  const media = await authorizePreview(actor, mediaId);
  const safeAsset = assetPath.split('/').filter(Boolean);
  if (safeAsset.some((part) => part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new HttpError(404, 'Media file not found');
  }
  const key = `${media.streamKey}/${safeAsset.join('/')}`;
  if (assetPath === 'enc.key') throw new HttpError(404, 'Media file not found');
  return { media, file: await mediaStorage.open(key.startsWith('processed/') ? key : `processed/${key}`) };
}

export async function previewKey(actor: MediaActor, mediaId: string) {
  const media = await authorizePreview(actor, mediaId);
  const key = `${media.streamKey}/enc.key`;
  return mediaStorage.readKey(key);
}

export async function previewStudentKey(actor: MediaActor, mediaId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can open published media');
  const organizationId = tenantId(actor);
  const courseIds = await activeStudentCourseIds(organizationId, actor.userId);
  const media = await prisma.mediaItem.findFirst({
    where: {
      organizationId,
      id: mediaId,
      deletedAt: null,
      visibility: MediaVisibility.PUBLISHED,
      status: MediaStatus.READY,
      courseId: { in: courseIds },
    },
    select: { streamKey: true, courseId: true, freePreview: true },
  });
  if (!media?.streamKey) throw new HttpError(404, 'Media key not found');
  await requireContentAccess({
    organizationId, userId: actor.userId, role: actor.role, courseId: media.courseId,
    published: true, freePreview: media.freePreview,
  });
  return mediaStorage.readKey(`${media.streamKey}/enc.key`);
}

export async function mediaUsage(actor: MediaActor) {
  assertMediaManager(actor.role);
  if (actor.role !== Role.ORG_ADMIN) throw new HttpError(403, 'Only organization admins can view storage usage');
  const organizationId = tenantId(actor);
  const aggregate = await prisma.mediaItem.aggregate({
    where: { organizationId },
    _sum: { storageBytes: true },
  });
  return {
    usedBytes: Number(aggregate._sum.storageBytes ?? 0n),
    quotaBytes: Number(storageQuotaBytes()),
    maxVideoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
    maxAudioBytes: env.MAX_AUDIO_MB * 1024 * 1024,
  };
}

export const mediaLimits = {
  maxVideoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
  maxAudioBytes: env.MAX_AUDIO_MB * 1024 * 1024,
  quotaBytes: Number(storageQuotaBytes()),
};

import { MediaJobStatus, MediaStatus, MediaType, MediaVisibility, Prisma, Role } from '@prisma/client';
import { fileTypeFromFile } from 'file-type';
import { basename, extname } from 'node:path';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { mediaStorage } from './media.storage.js';
import type { CreateMediaInput, MediaListInput, UpdateMediaInput } from './media.schemas.js';
import { expectedMediaMimeTypes } from './media.schemas.js';

const managerRoles = [Role.STAFF, Role.INSTRUCTOR, Role.ORG_ADMIN] as const;
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
      ...(role === Role.INSTRUCTOR ? { instructors: { some: { instructorId: userId } } } : {}),
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
    ...(actor.role === Role.ORG_ADMIN ? {} : { uploadedById: actor.userId }),
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

export async function listMedia(actor: MediaActor, filters: MediaListInput) {
  assertMediaManager(actor.role);
  const organizationId = tenantId(actor);
  const media = await prisma.mediaItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(actor.role === Role.ORG_ADMIN ? {} : { uploadedById: actor.userId }),
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
      job: { select: { status: true, attempts: true, progressPercent: true, error: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const aggregate = await prisma.mediaItem.aggregate({
    where: { organizationId },
    _sum: { storageBytes: true },
  });
  const storage = actor.role === Role.ORG_ADMIN ? {
    usedBytes: Number(aggregate._sum.storageBytes ?? 0n),
    quotaBytes: Number(storageQuotaBytes()),
    quotaGigabytes: env.MEDIA_STORAGE_QUOTA_GB,
  } : null;
  return {
    media: media.map(serializeMedia),
    storage,
  };
}

export async function listMediaCourses(actor: MediaActor) {
  assertMediaManager(actor.role);
  const organizationId = tenantId(actor);
  return prisma.course.findMany({
    where: {
      organizationId,
      ...(actor.role === Role.INSTRUCTOR ? { instructors: { some: { instructorId: actor.userId } } } : {}),
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
  const extension = input.extension.toLowerCase();
  const fileNameExtension = extname(basename(input.fileName.replaceAll('\\', '/'))).toLowerCase();
  if (fileNameExtension !== extension) throw new HttpError(400, 'File name extension does not match the selected type');
  if ((input.type === MediaType.VIDEO && !videoLimits.has(extension)) ||
    (input.type === MediaType.AUDIO && !audioLimits.has(extension))) {
    throw new HttpError(400, 'Unsupported file extension for this media type');
  }
  if (input.sizeBytes > fileLimitBytes(input.type)) {
    throw new HttpError(413, `Files of this type may not exceed ${input.type === MediaType.VIDEO ? env.MAX_VIDEO_MB : env.MAX_AUDIO_MB} MB`);
  }
  await validateCourseAndTopic(organizationId, actor.userId, actor.role, input.courseId, input.topicId);

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.mediaItem.aggregate({
        where: { organizationId },
        _sum: { storageBytes: true },
      });
      const usedBytes = current._sum.storageBytes ?? 0n;
      const requestedBytes = BigInt(input.sizeBytes);
      if (usedBytes + requestedBytes > storageQuotaBytes()) {
        throw new HttpError(413, 'Organization media storage quota would be exceeded');
      }
      const media = await tx.mediaItem.create({
        data: {
          organizationId,
          uploadedById: actor.userId,
          courseId: input.courseId,
          topicId: input.topicId ?? null,
          title: input.title,
          description: input.description,
          type: input.type,
          sizeBytes: requestedBytes,
          storageBytes: requestedBytes,
        },
      });
      await audit(tx, organizationId, actor.userId, 'MEDIA_UPLOAD_STARTED', media.id, {
        type: media.type,
        courseId: media.courseId,
        sizeBytes: input.sizeBytes,
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
  if (media.status !== MediaStatus.UPLOADING) throw new HttpError(409, 'This media item is not waiting for an upload');
  if (!media.sizeBytes || media.sizeBytes > BigInt(fileLimitBytes(media.type))) {
    throw new HttpError(413, 'The upload exceeds the configured size limit');
  }
  const maximumBytes = Number(media.sizeBytes);
  if (contentLength !== undefined && contentLength !== maximumBytes) {
    throw new HttpError(400, 'Upload content length does not match the declared file size');
  }
  const normalizedExtension = extension.toLowerCase();
  const claimedType = contentType?.toLowerCase().split(';')[0]?.trim();
  if (!expectedMediaMimeTypes(media.type, normalizedExtension).includes(claimedType ?? '')) {
    throw new HttpError(400, 'Upload MIME type does not match the declared file type');
  }
  const tempFile = await mediaStorage.createIncomingFile();
  try {
    const size = await mediaStorage.writeIncoming(request, tempFile.path, Math.min(fileLimitBytes(media.type), maximumBytes));
    if (size !== maximumBytes) throw new HttpError(400, 'Uploaded file size does not match the declared file size');
    const detected = await fileTypeFromFile(tempFile.path);
    if (!detected || !expectedMediaMimeTypes(media.type, normalizedExtension).includes(detected.mime)) {
      throw new HttpError(400, 'File contents do not match the selected extension and media type');
    }
    const originalKey = await mediaStorage.adoptIncoming(tempFile.path, media.organizationId, media.id, normalizedExtension);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.mediaItem.updateMany({
          where: { id: media.id, organizationId: media.organizationId, status: MediaStatus.UPLOADING, deletedAt: null },
          data: { status: MediaStatus.PROCESSING, originalKey },
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
      data: { title: input.title, description: input.description, courseId: input.courseId, topicId: input.topicId },
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
  return prisma.$transaction(async (tx) => {
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
  if (media.status !== MediaStatus.UPLOADING) throw new HttpError(409, 'Only an upload in progress can be cancelled');
  await prisma.$transaction(async (tx) => {
    await tx.mediaItem.update({ where: { id: media.id }, data: { deletedAt: new Date(), storageBytes: 0n } });
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

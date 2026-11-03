import { MediaJobStatus, MediaStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { ffmpegMediaProcessor, type MediaProcessor, type ProcessorResult } from './media.processor.js';
import { mediaStorage } from './media.storage.js';

const pollIntervalMs = 1000;

export async function recoverInterruptedJobs(organizationId?: string) {
  const interrupted = await prisma.mediaJob.findMany({
    where: { status: MediaJobStatus.PROCESSING, ...(organizationId ? { organizationId } : {}) },
    select: { id: true, organizationId: true, mediaId: true },
  });
  if (!interrupted.length) return;
  await prisma.$transaction(async (tx) => {
    for (const job of interrupted) {
      await tx.mediaJob.updateMany({
        where: { id: job.id, organizationId: job.organizationId, status: MediaJobStatus.PROCESSING },
        data: {
          status: MediaJobStatus.QUEUED,
          progressPercent: 0,
          error: 'Processing was interrupted by a server restart. The job has been queued again.',
          availableAt: new Date(),
          startedAt: null,
        },
      });
      await tx.mediaItem.updateMany({
        where: { id: job.mediaId, organizationId: job.organizationId, deletedAt: null },
        data: { status: MediaStatus.PROCESSING },
      });
    }
  });
  logger.info({ count: interrupted.length }, 'Recovered interrupted media jobs');
}

export async function processNextJob(processor: MediaProcessor, organizationId?: string): Promise<boolean> {
  const candidate = await prisma.mediaJob.findFirst({
    where: {
      status: MediaJobStatus.QUEUED,
      availableAt: { lte: new Date() },
      ...(organizationId ? { organizationId } : {}),
      media: { deletedAt: null, originalKey: { not: null } },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, organizationId: true, mediaId: true },
  });
  if (!candidate) return false;

  const job = await prisma.$transaction(async (tx) => {
    const claimed = await tx.mediaJob.updateMany({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        status: MediaJobStatus.QUEUED,
        availableAt: { lte: new Date() },
      },
      data: {
        status: MediaJobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        progressPercent: 0,
      },
    });
    if (claimed.count !== 1) return null;
    await tx.mediaItem.updateMany({
      where: { id: candidate.mediaId, organizationId: candidate.organizationId, deletedAt: null },
      data: { status: MediaStatus.PROCESSING },
    });
    return tx.mediaJob.findFirst({
      where: { id: candidate.id, organizationId: candidate.organizationId },
      include: { media: true },
    });
  });
  if (!job || !job.media.originalKey || job.media.deletedAt) return true;

  let lastProgressUpdate = 0;
  let processedResult: ProcessorResult | undefined;
  try {
    const result = await processor.process({
      id: job.media.id,
      organizationId: job.media.organizationId,
      type: job.media.type,
      originalKey: job.media.originalKey,
    }, async (progressPercent) => {
      const now = Date.now();
      if (progressPercent < 100 && now - lastProgressUpdate < 500) return;
      lastProgressUpdate = now;
      await prisma.mediaJob.updateMany({
        where: { id: job.id, organizationId: job.organizationId, status: MediaJobStatus.PROCESSING },
        data: { progressPercent: Math.min(99, Math.max(0, Math.floor(progressPercent))) },
      });
    });
    processedResult = result;

    await prisma.$transaction(async (tx) => {
      const currentUsage = await tx.mediaItem.aggregate({
        where: { organizationId: job.organizationId, id: { not: job.media.id } },
        _sum: { storageBytes: true },
      });
      const finalStorageBytes = result.processedBytes + Number(job.media.sizeBytes);
      if ((currentUsage._sum.storageBytes ?? 0n) + BigInt(finalStorageBytes) > BigInt(Math.floor(env.MEDIA_STORAGE_QUOTA_GB * 1024 ** 3))) {
        throw new HttpError(413, 'Processed media would exceed the organization storage quota');
      }
      const publishOnReady = job.media.publishOnReady;
      const updatedMedia = await tx.mediaItem.updateMany({
        where: { id: job.media.id, organizationId: job.organizationId, deletedAt: null },
        data: {
          status: MediaStatus.READY,
          durationSeconds: result.durationSeconds,
          streamKey: result.streamKey,
          thumbnailKey: result.thumbnailKey,
          storageBytes: BigInt(finalStorageBytes),
          visibility: publishOnReady ? 'PUBLISHED' : job.media.visibility,
          publishedAt: publishOnReady ? new Date() : job.media.publishedAt,
        },
      });
      if (updatedMedia.count !== 1) throw new HttpError(404, 'Media was deleted before processing completed');
      await tx.mediaJob.update({
        where: { organizationId_mediaId: { organizationId: job.organizationId, mediaId: job.media.id } },
        data: { status: MediaJobStatus.SUCCEEDED, progressPercent: 100, finishedAt: new Date(), error: null },
      });
      await tx.auditLog.create({
        data: {
          organizationId: job.organizationId,
          actorId: job.media.uploadedById,
          action: 'MEDIA_PROCESSING_COMPLETED',
          targetType: 'MediaItem',
          targetId: job.media.id,
          metadata: { durationSeconds: result.durationSeconds, type: job.media.type },
        },
      });
    });
    if (!env.KEEP_ORIGINAL_MEDIA && job.media.originalKey) {
      try {
        await mediaStorage.removeKey(job.media.originalKey);
        await prisma.mediaItem.updateMany({
          where: { id: job.media.id, organizationId: job.organizationId, deletedAt: null },
          data: { originalKey: null, storageBytes: BigInt(result.processedBytes) },
        });
      } catch (error) {
        logger.error({ err: error, mediaId: job.media.id }, 'Unable to remove the processed original media file');
      }
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 4000) : 'Unknown media processing error';
    if (processedResult?.streamKey.startsWith('processed/')) {
      try {
        await mediaStorage.removeProcessedDirectory(processedResult.streamKey.slice('processed/'.length));
      } catch (cleanupError) {
        logger.error({ err: cleanupError, mediaId: job.media.id }, 'Unable to clean failed media processing output');
      }
    }
    const retry = !(error instanceof HttpError && (error.status === 413 || error.status === 404)) &&
      job.attempts < env.MEDIA_PROCESSING_MAX_ATTEMPTS;
    const delayMs = Math.min(5 * 60_000, 1000 * (2 ** Math.max(0, job.attempts - 1)));
    await prisma.$transaction(async (tx) => {
      await tx.mediaJob.update({
        where: { organizationId_mediaId: { organizationId: job.organizationId, mediaId: job.mediaId } },
        data: {
          status: retry ? MediaJobStatus.QUEUED : MediaJobStatus.FAILED,
          error: message,
          progressPercent: 0,
          availableAt: retry ? new Date(Date.now() + delayMs) : new Date(),
          finishedAt: retry ? null : new Date(),
        },
      });
      await tx.mediaItem.updateMany({
        where: { id: job.mediaId, organizationId: job.organizationId, deletedAt: null },
        data: { status: retry ? MediaStatus.PROCESSING : MediaStatus.FAILED },
      });
      await tx.auditLog.create({
        data: {
          organizationId: job.organizationId,
          actorId: job.media.uploadedById,
          action: retry ? 'MEDIA_PROCESSING_RETRY_SCHEDULED' : 'MEDIA_PROCESSING_FAILED',
          targetType: 'MediaItem',
          targetId: job.media.id,
          metadata: { error: message, attempts: job.attempts, retry },
        },
      });
    });
    logger.error({ err: error, mediaId: job.media.id, retry, attempt: job.attempts }, 'Media processing failed');
    return true;
  }
}

export function startMediaWorker(processor: MediaProcessor = ffmpegMediaProcessor): () => void {
  let stopped = false;
  let working = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (delay = pollIntervalMs) => {
    if (stopped) return;
    timer = setTimeout(() => { void tick(); }, delay);
  };
  const tick = async () => {
    if (stopped || working) return;
    working = true;
    try {
      const foundJob = await processNextJob(processor);
      schedule(foundJob ? 0 : pollIntervalMs);
    } catch (error) {
      logger.error({ err: error }, 'Media worker could not process its queue');
      schedule(pollIntervalMs);
    } finally {
      working = false;
    }
  };

  void Promise.all([
    recoverInterruptedJobs(),
    mediaStorage.cleanStaleIncoming(),
  ])
    .then(() => schedule(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'Media worker could not recover interrupted jobs');
      schedule(pollIntervalMs);
    });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

import { MediaSource, MediaStatus, MediaType, MediaVisibility } from '@prisma/client';
import { z } from 'zod';

const mediaId = z.string().min(1).max(64);

const extensionMimeTypes: Record<MediaType, Record<string, string[]>> = {
  VIDEO: {
    '.mp4': ['video/mp4'],
    '.mov': ['video/quicktime'],
    '.webm': ['video/webm'],
    '.mkv': ['video/x-matroska'],
  },
  AUDIO: {
    '.mp3': ['audio/mpeg'],
    '.m4a': ['audio/mp4'],
    '.aac': ['audio/aac', 'audio/x-aac'],
    '.wav': ['audio/wav', 'audio/x-wav', 'audio/wave'],
    '.ogg': ['audio/ogg', 'application/ogg'],
  },
};

const extension = z.string().regex(/^\.[a-z0-9]{2,5}$/);

export function youtubeVideoIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const mediaIdSchema = z.object({ mediaId });

export const createMediaSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(''),
  courseId: mediaId,
  topicId: mediaId.nullable().optional(),
  type: z.nativeEnum(MediaType),
  source: z.nativeEnum(MediaSource).default(MediaSource.UPLOAD),
  youtubeUrl: z.string().url().optional(),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  extension: extension.optional(),
  mimeType: z.string().trim().min(3).max(100).optional(),
  fileName: z.string().min(1).max(255).refine((value) => !/[\\/]/.test(value), 'File name must not contain a path').optional(),
  publishOnReady: z.boolean().optional().default(false),
  freePreview: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (value.source === MediaSource.YOUTUBE) {
    if (value.type !== MediaType.VIDEO) {
      context.addIssue({ code: 'custom', path: ['type'], message: 'YouTube links can only be used for video media' });
    }
    if (!value.youtubeUrl || !youtubeVideoIdFromUrl(value.youtubeUrl)) {
      context.addIssue({ code: 'custom', path: ['youtubeUrl'], message: 'Enter a valid YouTube video URL' });
    }
    if (value.sizeBytes !== undefined || value.extension !== undefined || value.mimeType !== undefined || value.fileName !== undefined) {
      context.addIssue({ code: 'custom', path: ['source'], message: 'YouTube media cannot include uploaded-file metadata' });
    }
  } else if (value.youtubeUrl !== undefined) {
    context.addIssue({ code: 'custom', path: ['youtubeUrl'], message: 'A YouTube URL requires the YouTube link source' });
  }
  if (!value.sizeBytes || !value.extension || !value.mimeType || !value.fileName) {
    return;
  }
  const allowedMimeTypes = extensionMimeTypes[value.type][value.extension];
  if (!allowedMimeTypes || !allowedMimeTypes.includes(value.mimeType.toLowerCase())) {
    context.addIssue({ code: 'custom', path: ['extension'], message: 'File extension and MIME type do not match the selected media type' });
  }
});

export const updateMediaSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000),
  courseId: mediaId,
  topicId: mediaId.nullable(),
  freePreview: z.boolean().optional(),
});

export const mediaListQuerySchema = z.object({
  courseId: mediaId.optional(),
  type: z.nativeEnum(MediaType).optional(),
  status: z.nativeEnum(MediaStatus).optional(),
  visibility: z.nativeEnum(MediaVisibility).optional(),
  search: z.string().trim().max(100).optional(),
});

export const mediaAssetSchema = z.object({
  mediaId,
  rendition: z.string().regex(/^(720|480)$/).optional(),
  asset: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
});

export const mediaAssetParamsSchema = z.object({
  mediaId,
  asset: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
});

export const mediaRenditionParamsSchema = z.object({
  mediaId,
  rendition: z.enum(['720', '480']),
  asset: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
});

export const studentMediaListQuerySchema = z.object({
  type: z.nativeEnum(MediaType).optional(),
  courseId: mediaId.optional(),
  search: z.string().trim().max(100).optional(),
});

export const studentMediaProgressSchema = z.object({
  positionSeconds: z.number().finite().nonnegative().max(60 * 60 * 24),
  watchedSeconds: z.number().finite().nonnegative().max(60 * 60 * 24),
  completed: z.boolean().optional().default(false),
});

export type CreateMediaInput = z.infer<typeof createMediaSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
export type MediaListInput = z.infer<typeof mediaListQuerySchema>;
export type StudentMediaListInput = z.infer<typeof studentMediaListQuerySchema>;
export type StudentMediaProgressInput = z.infer<typeof studentMediaProgressSchema>;

export function expectedMediaMimeTypes(type: MediaType, fileExtension: string): string[] {
  return extensionMimeTypes[type][fileExtension] ?? [];
}

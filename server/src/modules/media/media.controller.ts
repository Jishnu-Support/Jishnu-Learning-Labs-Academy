import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import * as mediaService from './media.service.js';
import { createMediaSchema, mediaListQuerySchema, updateMediaSchema } from './media.schemas.js';

function actor(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Authentication required');
  return { organizationId: getOrganizationId(req), userId: req.auth.userId, role: req.auth.role };
}

function mediaId(req: Request): string {
  const value = req.params.mediaId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid media ID');
  return value;
}

function streamHeaders(res: Parameters<RequestHandler>[1], contentType: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
}

function assetMimeType(asset: string): string {
  if (asset.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (asset.endsWith('.ts')) return 'video/mp2t';
  if (asset.endsWith('.m4a')) return 'audio/mp4';
  if (asset.endsWith('.jpg') || asset.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export const list: RequestHandler = async (req, res) => {
  const filters = mediaListQuerySchema.parse(req.query);
  res.json({ data: await mediaService.listMedia(actor(req), filters) });
};

export const courses: RequestHandler = async (req, res) => {
  res.json({ data: { courses: await mediaService.listMediaCourses(actor(req)) } });
};

export const create: RequestHandler = async (req, res) => {
  const input = createMediaSchema.parse(req.body);
  const media = await mediaService.createMedia(actor(req), input);
  res.status(201).json({ data: { media } });
};

export const upload: RequestHandler = async (req, res) => {
  const rawLength = req.get('content-length');
  const contentLength = rawLength ? Number(rawLength) : undefined;
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
    throw new HttpError(400, 'Invalid upload content length');
  }
  const extension = req.get('x-media-extension');
  if (!extension) throw new HttpError(400, 'File extension header is required');
  const media = await mediaService.acceptUpload(
    actor(req),
    mediaId(req),
    req,
    contentLength,
    req.get('content-type'),
    extension,
  );
  res.status(202).json({ data: { media } });
};

export const update: RequestHandler = async (req, res) => {
  const input = updateMediaSchema.parse(req.body);
  res.json({ data: { media: await mediaService.updateMedia(actor(req), mediaId(req), input) } });
};

export const publish: RequestHandler = async (req, res) => {
  res.json({ data: { media: await mediaService.setMediaVisibility(actor(req), mediaId(req), true) } });
};

export const unpublish: RequestHandler = async (req, res) => {
  res.json({ data: { media: await mediaService.setMediaVisibility(actor(req), mediaId(req), false) } });
};

export const remove: RequestHandler = async (req, res) => {
  await mediaService.softDeleteMedia(actor(req), mediaId(req));
  res.status(204).end();
};

export const cancel: RequestHandler = async (req, res) => {
  await mediaService.cancelUpload(actor(req), mediaId(req));
  res.status(204).end();
};

export const retry: RequestHandler = async (req, res) => {
  res.json({ data: await mediaService.retryProcessing(actor(req), mediaId(req)) });
};

function pipeMedia(req: Request, res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2], assetPath: string) {
  void (async () => {
    const result = await mediaService.previewAsset(actor(req), mediaId(req), assetPath);
    streamHeaders(res, assetMimeType(assetPath));
    res.setHeader('Content-Length', result.file.size);
    result.file.stream.on('error', next);
    result.file.stream.pipe(res);
  })().catch(next);
}

export const streamAsset: RequestHandler = (req, res, next) => {
  const asset = req.params.asset;
  if (typeof asset !== 'string') throw new HttpError(400, 'Invalid media asset');
  pipeMedia(req, res, next, asset);
};

export const streamRenditionAsset: RequestHandler = (req, res, next) => {
  const rendition = req.params.rendition;
  const asset = req.params.asset;
  if (typeof rendition !== 'string' || typeof asset !== 'string') throw new HttpError(400, 'Invalid media asset');
  pipeMedia(req, res, next, `${rendition}/${asset}`);
};

export const key: RequestHandler = async (req, res) => {
  const buffer = await mediaService.previewKey(actor(req), mediaId(req));
  if (buffer.byteLength !== 16) throw new HttpError(404, 'Media key not found');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
};

export const storage: RequestHandler = async (req, res) => {
  res.json({ data: { storage: await mediaService.mediaUsage(actor(req)) } });
};

export const limits: RequestHandler = (_req, res) => {
  res.json({ data: { limits: mediaService.mediaLimits } });
};

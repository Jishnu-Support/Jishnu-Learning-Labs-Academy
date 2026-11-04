import type { RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import { tutorListQuerySchema } from './tutor.schemas.js';
import * as tutorService from './tutor.service.js';

function userId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.userId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid Tutor ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({ data: await tutorService.listTutor(getOrganizationId(req), tutorListQuerySchema.parse(req.query)) });
};

export const get: RequestHandler = async (req, res) => {
  res.json({ data: { tutor: await tutorService.getTutor(getOrganizationId(req), userId(req)) } });
};

export const create: RequestHandler = async (req, res) => {
  const result = await tutorService.createTutor(getOrganizationId(req), req.auth!.userId, req.body);
  res.status(201).json({ data: result });
};

export const update: RequestHandler = async (req, res) => {
  res.json({
    data: {
      tutor: await tutorService.updateTutor(getOrganizationId(req), userId(req), req.auth!.userId, req.body),
    },
  });
};

export const suspend: RequestHandler = async (req, res) => {
  res.json({ data: { tutor: await tutorService.suspendTutor(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

export const reactivate: RequestHandler = async (req, res) => {
  res.json({ data: { tutor: await tutorService.reactivateTutor(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

export const uploadPhoto: RequestHandler = async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Select an image file');
  const result = await tutorService.uploadTutorPhoto(
    getOrganizationId(req),
    userId(req),
    req.auth!.userId,
    req.auth!.role,
    req.file.buffer,
  );
  res.json({ data: result });
};

export const photo: RequestHandler = async (req, res) => {
  const file = await tutorService.getTutorPhoto(getOrganizationId(req), userId(req));
  res.set({ 'Content-Type': file.mimeType, 'Content-Length': String(file.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  file.stream.pipe(res);
};

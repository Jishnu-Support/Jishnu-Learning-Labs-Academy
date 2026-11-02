import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { notesListQuerySchema } from './notes.schemas.js';
import * as notesService from './notes.service.js';
import { HttpError } from '../../utils/http-error.js';

function noteId(req: Request): string {
  const value = req.params.noteId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid note ID');
  return value;
}

function disposition(name: string, type: 'inline' | 'attachment'): string {
  const fallback = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function streamHeaders(res: Parameters<RequestHandler>[1], file: { mimeType: string; originalName: string }, type: 'inline' | 'attachment') {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', disposition(file.originalName, type));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export const list: RequestHandler = async (req, res) => {
  res.json({
    data: await notesService.listNotes(
      getOrganizationId(req),
      req.auth!.userId,
      req.auth!.role,
      notesListQuerySchema.parse(req.query),
    ),
  });
};

export const create: RequestHandler = async (req, res) => {
  const note = await notesService.createNote(getOrganizationId(req), req.auth!.userId, req.body, req.file);
  res.status(201).json({ data: { note } });
};

export const update: RequestHandler = async (req, res) => {
  const note = await notesService.updateNote(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role, req.body);
  res.json({ data: { note } });
};

export const publish: RequestHandler = async (req, res) => {
  const note = await notesService.setNotePublished(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role, true);
  res.json({ data: { note } });
};

export const unpublish: RequestHandler = async (req, res) => {
  const note = await notesService.setNotePublished(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role, false);
  res.json({ data: { note } });
};

export const remove: RequestHandler = async (req, res) => {
  await notesService.softDeleteNote(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role);
  res.status(204).end();
};

export const view: RequestHandler = async (req, res, next) => {
  const result = await notesService.noteForView(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!result.file) {
    res.type('application/json').json({ data: { note: result.note } });
    return;
  }
  streamHeaders(res, result.file, 'inline');
  res.setHeader('Content-Length', result.file.size);
  result.file.stream.on('error', next);
  result.file.stream.pipe(res);
};

export const download: RequestHandler = async (req, res, next) => {
  const file = await notesService.noteForDownload(getOrganizationId(req), noteId(req), req.auth!.userId, req.auth!.role);
  streamHeaders(res, file, 'attachment');
  res.setHeader('Content-Length', file.size);
  file.stream.on('error', next);
  file.stream.pipe(res);
};

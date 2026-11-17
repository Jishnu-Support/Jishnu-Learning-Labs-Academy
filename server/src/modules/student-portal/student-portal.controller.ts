import type { Request, RequestHandler } from 'express';
import { ExpertSessionStatus } from '@prisma/client';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import * as service from './student-portal.service.js';
import {
  attendanceMarkSchema, createLibraryItemSchema, createSessionSchema, gameRatingSchema,
  libraryQuerySchema, sessionListQuerySchema, updateLibraryItemSchema, updateSessionSchema,
} from './student-portal.schemas.js';

function actor(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Authentication required');
  return { organizationId: getOrganizationId(req), userId: req.auth.userId, role: req.auth.role };
}

function param(req: Request, key: string) {
  const value = req.params[key];
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${key}`);
  return value;
}

export const listSessions: RequestHandler = async (req, res) => {
  const query = sessionListQuerySchema.parse(req.query);
  res.json({ data: { sessions: await service.listSessions(actor(req), query.tab, query.courseId) } });
};

export const createSession: RequestHandler = async (req, res) => {
  const input = createSessionSchema.parse(req.body);
  res.status(201).json({ data: { session: await service.createSession(actor(req), input) } });
};

export const updateSession: RequestHandler = async (req, res) => {
  const input = updateSessionSchema.parse(req.body);
  res.json({ data: { session: await service.updateSession(actor(req), param(req, 'sessionId'), input) } });
};

export const cancelSession: RequestHandler = async (req, res) => {
  res.json({ data: { session: await service.changeSessionStatus(actor(req), param(req, 'sessionId'), ExpertSessionStatus.CANCELLED) } });
};

export const startSession: RequestHandler = async (req, res) => {
  res.json({ data: { session: await service.changeSessionStatus(actor(req), param(req, 'sessionId'), ExpertSessionStatus.LIVE) } });
};

export const joinSession: RequestHandler = async (req, res) => {
  res.json({ data: { room: await service.joinSession(actor(req), param(req, 'sessionId')) } });
};

export const hostSession: RequestHandler = async (req, res) => {
  res.json({ data: { room: await service.hostSession(actor(req), param(req, 'sessionId')) } });
};

export const attendees: RequestHandler = async (req, res) => {
  res.json({ data: { attendees: await service.listSessionAttendees(actor(req), param(req, 'sessionId')) } });
};

export const markAttendance: RequestHandler = async (req, res) => {
  const input = attendanceMarkSchema.parse(req.body);
  res.json({ data: { attendance: await service.markAttendance(actor(req), param(req, 'sessionId'), param(req, 'studentId'), input.status) } });
};

export const studentAttendance: RequestHandler = async (req, res) => {
  const query = libraryQuerySchema.pick({ courseId: true }).parse(req.query);
  res.json({ data: await service.studentAttendance(actor(req), query.courseId) });
};

export const listLibrary: RequestHandler = async (req, res) => {
  const query = libraryQuerySchema.parse(req.query);
  res.json({ data: await service.listLibrary(actor(req), query) });
};

export const createLibraryItem: RequestHandler = async (req, res) => {
  const input = createLibraryItemSchema.parse(req.body);
  res.status(201).json({ data: { item: await service.createLibraryItem(actor(req), input, req.file) } });
};

export const getLibraryItem: RequestHandler = async (req, res) => {
  res.json({ data: { item: await service.getLibraryItem(actor(req), param(req, 'itemId')) } });
};

export const viewLibraryContent: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.viewLibraryContent(actor(req), param(req, 'itemId'));
    const fallbackName = result.item.originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', result.item.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(result.item.originalName)}`);
    res.setHeader('Content-Length', result.file.size);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    result.file.stream.on('error', next);
    result.file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

export const updateLibraryItem: RequestHandler = async (req, res) => {
  const input = updateLibraryItemSchema.parse(req.body);
  res.json({ data: { item: await service.updateLibraryItem(actor(req), param(req, 'itemId'), input) } });
};

export const deleteLibraryItem: RequestHandler = async (req, res) => {
  await service.deleteLibraryItem(actor(req), param(req, 'itemId'));
  res.status(204).end();
};

export const saveLibraryItem: RequestHandler = async (req, res) => {
  const saved = req.method === 'PUT';
  res.json({ data: await service.saveLibraryItem(actor(req), param(req, 'itemId'), saved) });
};

export const studentCertificates: RequestHandler = async (req, res) => {
  res.json({ data: { certificates: await service.studentCertificates(actor(req)) } });
};

export const publicCertificate: RequestHandler = async (req, res) => {
  res.json({ data: { certificate: await service.publicCertificate(param(req, 'verificationCode')) } });
};

export const studentKnowledge: RequestHandler = async (req, res) => {
  res.json({ data: await service.studentKnowledge(actor(req)) });
};

export const studentReports: RequestHandler = async (req, res) => {
  res.json({ data: await service.studentReports(actor(req)) });
};

export const rateKnowledgeGame: RequestHandler = async (req, res) => {
  const input = gameRatingSchema.parse(req.body);
  res.json({ data: await service.rateKnowledgeGame(actor(req), input) });
};

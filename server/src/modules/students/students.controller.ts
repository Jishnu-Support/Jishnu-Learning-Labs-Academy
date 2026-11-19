import type { RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import { revealMySensitiveSchema, revealStudentSensitiveSchema, studentListQuerySchema } from './students.schemas.js';
import * as studentsService from './students.service.js';

function studentId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.studentId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid student ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({
    data: await studentsService.listStudents(
      getOrganizationId(req),
      studentListQuerySchema.parse(req.query),
      req.auth!.role,
      req.auth!.userId,
    ),
  });
};

export const get: RequestHandler = async (req, res) => {
  res.json({
    data: {
      student: await studentsService.getStudent(getOrganizationId(req), studentId(req), req.auth!.role, req.auth!.userId),
    },
  });
};

export const suspend: RequestHandler = async (req, res) => {
  res.json({ data: { student: await studentsService.suspendStudent(getOrganizationId(req), studentId(req), req.auth!.userId) } });
};

export const reactivate: RequestHandler = async (req, res) => {
  res.json({ data: { student: await studentsService.reactivateStudent(getOrganizationId(req), studentId(req), req.auth!.userId) } });
};

export const myProfile: RequestHandler = async (req, res) => {
  res.json({ data: { profile: await studentsService.getMyStudentProfile(getOrganizationId(req), req.auth!.userId) } });
};

export const updateMyProfile: RequestHandler = async (req, res) => {
  res.json({
    data: {
      profile: await studentsService.updateMyStudentProfile(
        getOrganizationId(req),
        req.auth!.userId,
        req.auth!.userId,
        req.body,
      ),
    },
  });
};

export const uploadMyPhoto: RequestHandler = async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Select an image file');
  res.json({
    data: {
      photo: await studentsService.uploadMyStudentPhoto(getOrganizationId(req), req.auth!.userId, req.file.buffer),
    },
  });
};

export const myPhoto: RequestHandler = async (req, res) => {
  const file = await studentsService.getMyStudentPhoto(getOrganizationId(req), req.auth!.userId);
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  file.stream.pipe(res);
};

export const studentPhoto: RequestHandler = async (req, res) => {
  if (req.auth!.role !== 'ORG_ADMIN' && req.auth!.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'Only administrators can access student profile photos');
  }
  const file = await studentsService.getStudentPhoto(getOrganizationId(req), studentId(req));
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  file.stream.pipe(res);
};

export const revealMySensitive: RequestHandler = async (req, res) => {
  const input = revealMySensitiveSchema.parse(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    data: {
      identifier: await studentsService.revealStudentIdentifier(
        getOrganizationId(req),
        req.auth!.userId,
        req.auth!.userId,
        req.auth!.role,
        input,
      ),
    },
  });
};

export const revealSensitive: RequestHandler = async (req, res) => {
  const input = revealStudentSensitiveSchema.parse(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    data: {
      identifier: await studentsService.revealStudentIdentifier(
        getOrganizationId(req),
        studentId(req),
        req.auth!.userId,
        req.auth!.role,
        input,
      ),
    },
  });
};

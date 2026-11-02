import type { RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import { studentListQuerySchema } from './students.schemas.js';
import * as studentsService from './students.service.js';

function studentId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.studentId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid student ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({ data: await studentsService.listStudents(getOrganizationId(req), studentListQuerySchema.parse(req.query)) });
};

export const get: RequestHandler = async (req, res) => {
  res.json({ data: { student: await studentsService.getStudent(getOrganizationId(req), studentId(req)) } });
};

export const suspend: RequestHandler = async (req, res) => {
  res.json({ data: { student: await studentsService.suspendStudent(getOrganizationId(req), studentId(req), req.auth!.userId) } });
};

export const reactivate: RequestHandler = async (req, res) => {
  res.json({ data: { student: await studentsService.reactivateStudent(getOrganizationId(req), studentId(req), req.auth!.userId) } });
};

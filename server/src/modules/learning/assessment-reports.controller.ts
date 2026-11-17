import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import * as reportService from './assessment-reports.service.js';
import { assessmentReportQuerySchema, assessmentReportStudentQuerySchema } from './assessment-reports.schemas.js';

function actor(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Authentication required');
  return { organizationId: getOrganizationId(req), userId: req.auth.userId, role: req.auth.role };
}

function param(req: Request, key: string) {
  const value = req.params[key];
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${key}`);
  return value;
}

export const listReports: RequestHandler = async (req, res) => {
  const filters = assessmentReportQuerySchema.parse(req.query);
  res.json({ data: await reportService.listAssessmentReports(actor(req), filters) });
};

export const studentHistory: RequestHandler = async (req, res) => {
  const filters = assessmentReportStudentQuerySchema.parse(req.query);
  if (!filters.assessmentId) throw new HttpError(400, 'Assessment ID is required');
  res.json({ data: await reportService.getAssessmentReportStudent(actor(req), param(req, 'studentId'), filters.assessmentId) });
};

export const exportReports: RequestHandler = async (req, res) => {
  const filters = assessmentReportQuerySchema.parse(req.query);
  const csv = await reportService.exportAssessmentReports(actor(req), filters);
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="assessment-reports.csv"');
  res.send(csv);
};

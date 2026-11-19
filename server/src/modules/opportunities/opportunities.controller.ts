import type { Request, RequestHandler, Response } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { applicationParamsSchema, opportunityParamsSchema } from './opportunities.schemas.js';
import * as service from './opportunities.service.js';

function jobOpeningId(req: Request) {
  return opportunityParamsSchema.parse(req.params).jobOpeningId;
}

function applicationId(req: Request) {
  return applicationParamsSchema.parse(req.params).applicationId;
}

function sendResume(res: Response, file: Awaited<ReturnType<typeof service.getApplicationResume>>) {
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.size),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  file.stream.pipe(res);
}

export const listForStudent: RequestHandler = async (req, res) => {
  res.json({ data: await service.listStudentOpportunities(getOrganizationId(req), req.auth!.userId) });
};

export const apply: RequestHandler = async (req, res) => {
  res.status(201).json({
    data: {
      application: await service.createApplication(getOrganizationId(req), req.auth!.userId, jobOpeningId(req), req.file),
    },
  });
};

export const listManaged: RequestHandler = async (req, res) => {
  res.json({ data: { openings: await service.listManagedOpportunities(req.auth!.organizationId, req.auth!.role) } });
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json({
    data: {
      opening: await service.createOpportunity(req.auth!.organizationId, req.auth!.userId, req.body),
    },
  });
};

export const applications: RequestHandler = async (req, res) => {
  res.json({ data: { applications: await service.listApplications(req.auth!.organizationId, req.auth!.role) } });
};

export const applicationResume: RequestHandler = async (req, res) => {
  const file = await service.getApplicationResume(
    req.auth!.organizationId,
    req.auth!.role,
    req.auth!.userId,
    applicationId(req),
  );
  sendResume(res, file);
};


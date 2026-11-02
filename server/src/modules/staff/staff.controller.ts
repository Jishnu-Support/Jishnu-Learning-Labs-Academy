import type { RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import { staffListQuerySchema } from './staff.schemas.js';
import * as staffService from './staff.service.js';

function userId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.userId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid staff ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({ data: await staffService.listStaff(getOrganizationId(req), staffListQuerySchema.parse(req.query)) });
};

export const get: RequestHandler = async (req, res) => {
  res.json({ data: { staff: await staffService.getStaff(getOrganizationId(req), userId(req)) } });
};

export const create: RequestHandler = async (req, res) => {
  const result = await staffService.createStaff(getOrganizationId(req), req.auth!.userId, req.body);
  res.status(201).json({ data: result });
};

export const update: RequestHandler = async (req, res) => {
  res.json({
    data: {
      staff: await staffService.updateStaff(getOrganizationId(req), userId(req), req.auth!.userId, req.body),
    },
  });
};

export const suspend: RequestHandler = async (req, res) => {
  res.json({ data: { staff: await staffService.suspendStaff(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

export const reactivate: RequestHandler = async (req, res) => {
  res.json({ data: { staff: await staffService.reactivateStaff(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

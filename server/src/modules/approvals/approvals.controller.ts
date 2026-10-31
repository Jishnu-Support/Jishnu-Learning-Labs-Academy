import type { RequestHandler } from 'express';
import * as service from './approvals.service.js';

export const listPending: RequestHandler = async (req, res) => {
  const registrations = await service.listPending(req.auth!.userId);
  res.json({ data: { registrations } });
};

export const approve: RequestHandler = async (req, res) => {
  const result = await service.approve(req.params.studentId as string, req.auth!.userId);
  res.json({ data: result });
};

export const reject: RequestHandler = async (req, res) => {
  const result = await service.reject(req.params.studentId as string, req.auth!.userId, req.body.reason);
  res.json({ data: result });
};

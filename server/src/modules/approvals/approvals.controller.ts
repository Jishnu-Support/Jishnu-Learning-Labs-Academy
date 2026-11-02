import type { RequestHandler } from 'express';
import * as service from './approvals.service.js';

export const listPendingStudents: RequestHandler = async (req, res) => {
  const registrations = await service.listPendingStudents(req.auth!.organizationId);
  res.json({ data: { registrations } });
};

export const approveStudent: RequestHandler = async (req, res) => {
  const result = await service.approveStudent(req.auth!.organizationId, req.params.studentId as string, req.auth!.userId);
  res.json({ data: result });
};

export const rejectStudent: RequestHandler = async (req, res) => {
  const result = await service.rejectStudent(req.auth!.organizationId, req.params.studentId as string, req.auth!.userId, req.body.reason);
  res.json({ data: result });
};

export const listPendingStaff: RequestHandler = async (req, res) => {
  const registrations = await service.listPendingStaff(req.auth!.organizationId);
  res.json({ data: { registrations } });
};

export const approveStaff: RequestHandler = async (req, res) => {
  const result = await service.approveStaff(req.auth!.organizationId, req.params.userId as string, req.auth!.userId);
  res.json({ data: result });
};

export const rejectStaff: RequestHandler = async (req, res) => {
  const result = await service.rejectStaff(req.auth!.organizationId, req.params.userId as string, req.auth!.userId, req.body.reason);
  res.json({ data: result });
};

export const listPendingInstructors: RequestHandler = async (req, res) => {
  const registrations = await service.listPendingInstructors(req.auth!.organizationId);
  res.json({ data: { registrations } });
};

export const approveInstructor: RequestHandler = async (req, res) => {
  const result = await service.approveInstructor(req.auth!.organizationId, req.params.userId as string, req.auth!.userId);
  res.json({ data: result });
};

export const rejectInstructor: RequestHandler = async (req, res) => {
  const result = await service.rejectInstructor(req.auth!.organizationId, req.params.userId as string, req.auth!.userId, req.body.reason);
  res.json({ data: result });
};

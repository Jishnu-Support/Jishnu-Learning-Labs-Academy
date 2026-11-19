import type { RequestHandler } from 'express';
import { auditSessionQuerySchema } from './audit.schemas.js';
import * as service from './audit.service.js';

export const sessions: RequestHandler = async (req, res) => {
  res.json({ data: await service.listSessions(auditSessionQuerySchema.parse(req.query)) });
};

import type { RequestHandler } from 'express';
import { listStudents } from './students.service.js';

export const list: RequestHandler = async (req, res) => {
  const students = await listStudents(req.auth!.userId, req.auth!.role);
  res.json({ data: { students } });
};

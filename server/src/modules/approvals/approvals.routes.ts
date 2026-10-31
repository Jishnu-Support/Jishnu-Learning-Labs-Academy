import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './approvals.controller.js';
import { decisionSchema, studentParamSchema } from './approvals.schemas.js';

export const approvalsRouter = Router();
approvalsRouter.use(authenticate, requireRoles(Role.INSTRUCTOR));
approvalsRouter.get('/pending', controller.listPending);
approvalsRouter.post('/:studentId/approve', validateParams(studentParamSchema), controller.approve);
approvalsRouter.post('/:studentId/reject', validateParams(studentParamSchema), validateBody(decisionSchema), controller.reject);

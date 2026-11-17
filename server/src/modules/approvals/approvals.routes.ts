import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './approvals.controller.js';
import { decisionSchema, studentParamSchema, userParamSchema } from './approvals.schemas.js';

export const approvalsRouter = Router();
approvalsRouter.use(authenticate, requireRoles(Role.TUTOR), requireOrganization);
approvalsRouter.get('/pending', controller.listPendingStudents);
approvalsRouter.post('/:studentId/approve', validateParams(studentParamSchema), controller.approveStudent);
approvalsRouter.post('/:studentId/reject', validateParams(studentParamSchema), validateBody(decisionSchema), controller.rejectStudent);

export const orgAdminApprovalsRouter = Router();
orgAdminApprovalsRouter.use(authenticate, requireRoles(Role.ORG_ADMIN), requireOrganization);
orgAdminApprovalsRouter.get('/students/registrations/pending', controller.listPendingStudents);
orgAdminApprovalsRouter.post('/students/registrations/:studentId/approve', validateParams(studentParamSchema), controller.approveStudent);
orgAdminApprovalsRouter.post(
  '/students/registrations/:studentId/reject',
  validateParams(studentParamSchema),
  validateBody(decisionSchema),
  controller.rejectStudent,
);
orgAdminApprovalsRouter.get('/tutors/pending', controller.listPendingTutor);
orgAdminApprovalsRouter.post('/tutors/:userId/approve', validateParams(userParamSchema), controller.approveTutor);
orgAdminApprovalsRouter.post(
  '/tutors/:userId/reject',
  validateParams(userParamSchema),
  validateBody(decisionSchema),
  controller.rejectTutor,
);

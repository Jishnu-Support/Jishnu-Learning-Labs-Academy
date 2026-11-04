import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateParams } from '../../middleware/validate.js';
import * as controller from './students.controller.js';
import { studentParamSchema } from './students.schemas.js';

export const studentsRouter = Router();
studentsRouter.use(authenticate, requireOrganization);
studentsRouter.get('/', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR, Role.TUTOR), controller.list);
studentsRouter.get('/:studentId', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR, Role.TUTOR), validateParams(studentParamSchema), controller.get);
studentsRouter.post('/:studentId/suspend', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), validateParams(studentParamSchema), controller.suspend);
studentsRouter.post('/:studentId/reactivate', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), validateParams(studentParamSchema), controller.reactivate);

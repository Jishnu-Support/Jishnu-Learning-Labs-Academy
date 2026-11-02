import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './staff.controller.js';
import { createStaffSchema, staffParamSchema, updateStaffSchema } from './staff.schemas.js';

export const staffRouter = Router();
staffRouter.use(authenticate, requireOrganization);
staffRouter.get('/', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), controller.list);
staffRouter.get('/:userId', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), validateParams(staffParamSchema), controller.get);
staffRouter.post('/', requireRoles(Role.ORG_ADMIN), validateBody(createStaffSchema), controller.create);
staffRouter.patch('/:userId', requireRoles(Role.ORG_ADMIN), validateParams(staffParamSchema), validateBody(updateStaffSchema), controller.update);
staffRouter.post('/:userId/suspend', requireRoles(Role.ORG_ADMIN), validateParams(staffParamSchema), controller.suspend);
staffRouter.post('/:userId/reactivate', requireRoles(Role.ORG_ADMIN), validateParams(staffParamSchema), controller.reactivate);

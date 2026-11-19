import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRoles } from '../../middleware/authenticate.js';
import * as controller from './audit.controller.js';

export const superAdminAuditRouter = Router();
superAdminAuditRouter.use(authenticate, requireRoles(Role.SUPER_ADMIN));
superAdminAuditRouter.get('/sessions', controller.sessions);

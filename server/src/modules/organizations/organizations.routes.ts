import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import * as controller from './organizations.controller.js';
import {
  organizationParamSchema,
  organizationRegistrationSchema,
  platformOwnerActionSchema,
  publicBrandQuerySchema,
  rejectionSchema,
} from './organizations.schemas.js';

export const organizationsRouter = Router();
export function createOrganizationRegistrationLimiter(limit = env.NODE_ENV === 'test' ? 1000 : 5) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
}
organizationsRouter.post('/register', createOrganizationRegistrationLimiter(), validateBody(organizationRegistrationSchema), controller.register);

export function createPublicBrandLimiter(limit = env.NODE_ENV === 'test' ? 1000 : 60) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
}

export const publicBrandRouter = Router();
publicBrandRouter.get('/brand', createPublicBrandLimiter(), validateQuery(publicBrandQuerySchema), controller.publicBrand);

export const superAdminOrganizationsRouter = Router();
superAdminOrganizationsRouter.use(authenticate, requireRoles(Role.SUPER_ADMIN));
superAdminOrganizationsRouter.get('/', controller.listOrganizations);
superAdminOrganizationsRouter.get('/pending', controller.listPending);
superAdminOrganizationsRouter.post('/:organizationId/approve', validateParams(organizationParamSchema), controller.approve);
superAdminOrganizationsRouter.post(
  '/:organizationId/reject',
  validateParams(organizationParamSchema),
  validateBody(rejectionSchema),
  controller.reject,
);
superAdminOrganizationsRouter.post('/:organizationId/suspend', validateParams(organizationParamSchema), controller.suspend);
superAdminOrganizationsRouter.post('/:organizationId/reactivate', validateParams(organizationParamSchema), controller.reactivate);
superAdminOrganizationsRouter.post(
  '/:organizationId/platform-owner',
  validateParams(organizationParamSchema),
  validateBody(platformOwnerActionSchema),
  controller.setPlatformOwner,
);

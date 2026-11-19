import { Router } from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import * as controller from './opportunities.controller.js';
import { applicationParamsSchema, createOpportunitySchema, opportunityParamsSchema } from './opportunities.schemas.js';

const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const uploadResume: RequestHandler = (req, res, next) => {
  resumeUpload.single('resume')(req, res, (error?: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'Resume files must be 5 MB or smaller'));
      return;
    }
    next(error);
  });
};

export const studentOpportunitiesRouter = Router();
studentOpportunitiesRouter.use(authenticate, requireOrganization, requireRoles(Role.STUDENT));
studentOpportunitiesRouter.get('/', controller.listForStudent);
studentOpportunitiesRouter.post(
  '/:jobOpeningId/applications',
  validateParams(opportunityParamsSchema),
  uploadResume,
  controller.apply,
);

export const orgAdminOpportunitiesRouter = Router();
orgAdminOpportunitiesRouter.use(authenticate, requireOrganization, requireRoles(Role.ORG_ADMIN));
orgAdminOpportunitiesRouter.get('/', controller.listManaged);
orgAdminOpportunitiesRouter.post('/', validateBody(createOpportunitySchema), controller.create);
orgAdminOpportunitiesRouter.get('/applications', controller.applications);
orgAdminOpportunitiesRouter.get('/applications/:applicationId/resume', validateParams(applicationParamsSchema), controller.applicationResume);

export const superAdminOpportunitiesRouter = Router();
superAdminOpportunitiesRouter.use(authenticate, requireRoles(Role.SUPER_ADMIN));
superAdminOpportunitiesRouter.get('/', controller.listManaged);
superAdminOpportunitiesRouter.post('/', validateBody(createOpportunitySchema), controller.create);

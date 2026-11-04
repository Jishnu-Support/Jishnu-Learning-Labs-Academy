import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import * as controller from './tutor.controller.js';
import { createTutorSchema, tutorParamSchema, updateTutorSchema } from './tutor.schemas.js';

export const tutorRouter = Router();
tutorRouter.use(authenticate, requireOrganization);
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mapUploadError: import('express').ErrorRequestHandler = (error, _req, _res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(new HttpError(413, 'Profile photos must be no larger than 5 MB'));
    return;
  }
  next(error);
};
tutorRouter.get('/', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), controller.list);
tutorRouter.get('/:userId/photo', validateParams(tutorParamSchema), controller.photo);
tutorRouter.get('/:userId', requireRoles(Role.ORG_ADMIN, Role.INSTRUCTOR), validateParams(tutorParamSchema), controller.get);
tutorRouter.post('/', requireRoles(Role.ORG_ADMIN), validateBody(createTutorSchema), controller.create);
tutorRouter.put('/:userId/photo', requireRoles(Role.ORG_ADMIN, Role.TUTOR), validateParams(tutorParamSchema), photoUpload.single('photo'), mapUploadError, controller.uploadPhoto);
tutorRouter.patch('/:userId', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), validateBody(updateTutorSchema), controller.update);
tutorRouter.post('/:userId/suspend', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), controller.suspend);
tutorRouter.post('/:userId/reactivate', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), controller.reactivate);

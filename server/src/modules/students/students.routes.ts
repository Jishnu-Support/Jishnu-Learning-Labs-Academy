import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import * as controller from './students.controller.js';
import { revealMySensitiveSchema, revealStudentSensitiveSchema, studentParamSchema, studentProfileUpdateSchema } from './students.schemas.js';

export const studentsRouter = Router();
studentsRouter.use(authenticate, requireOrganization);
const sensitiveRevealLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mapUploadError: import('express').ErrorRequestHandler = (error, _req, _res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(new HttpError(413, 'Profile photos must be no larger than 5 MB'));
    return;
  }
  next(error);
};
studentsRouter.get('/me', requireRoles(Role.STUDENT), controller.myProfile);
studentsRouter.put('/me', requireRoles(Role.STUDENT), validateBody(studentProfileUpdateSchema), controller.updateMyProfile);
studentsRouter.get('/me/photo', requireRoles(Role.STUDENT), controller.myPhoto);
studentsRouter.put('/me/photo', requireRoles(Role.STUDENT), photoUpload.single('photo'), mapUploadError, controller.uploadMyPhoto);
studentsRouter.post('/me/sensitive/reveal', requireRoles(Role.STUDENT), sensitiveRevealLimiter, validateBody(revealMySensitiveSchema), controller.revealMySensitive);
studentsRouter.post(
  '/:studentId/sensitive/reveal',
  requireRoles(Role.ORG_ADMIN),
  sensitiveRevealLimiter,
  validateParams(studentParamSchema),
  validateBody(revealStudentSensitiveSchema),
  controller.revealSensitive,
);
studentsRouter.get('/:studentId/photo', requireRoles(Role.ORG_ADMIN), validateParams(studentParamSchema), controller.studentPhoto);
studentsRouter.get('/', requireRoles(Role.ORG_ADMIN, Role.TUTOR), controller.list);
studentsRouter.get('/:studentId', requireRoles(Role.ORG_ADMIN, Role.TUTOR), validateParams(studentParamSchema), controller.get);
studentsRouter.post('/:studentId/suspend', requireRoles(Role.ORG_ADMIN), validateParams(studentParamSchema), controller.suspend);
studentsRouter.post('/:studentId/reactivate', requireRoles(Role.ORG_ADMIN), validateParams(studentParamSchema), controller.reactivate);

import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';
import * as controller from './auth.controller.js';
import {
  changePasswordSchema,
  portalLoginSchema,
  tutorLoginSchema,
  tutorRegistrationSchema,
  studentLoginSchema,
  studentRegistrationSchema,
  superAdminLoginSchema,
  registrationStatusSchema,
} from './auth.schemas.js';

export const authRouter = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const registrationOptionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const registrationStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('receipt');

const registrationReceiptUpload: RequestHandler = (req, res, next) => {
  receiptUpload(req, res, (error?: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'Registration receipts must be 5 MB or smaller'));
      return;
    }
    next(error);
  });
};

authRouter.post('/students/register', authLimiter, registrationReceiptUpload, validateBody(studentRegistrationSchema), controller.registerStudent);
authRouter.get('/registration-options', registrationOptionsLimiter, controller.registrationOptions);
authRouter.post('/students/registration-status', registrationStatusLimiter, validateBody(registrationStatusSchema), controller.studentRegistrationStatus);
authRouter.post('/instructors/register', authLimiter, controller.deprecatedInstructorRegistration);
authRouter.post('/tutors/register', authLimiter, registrationReceiptUpload, validateBody(tutorRegistrationSchema), controller.registerTutor);
authRouter.post('/students/login', authLimiter, validateBody(studentLoginSchema), controller.studentLogin);
authRouter.post('/instructors/login', authLimiter, controller.deprecatedInstructorLogin);
authRouter.post('/tutors/login', authLimiter, validateBody(tutorLoginSchema), controller.tutorLogin);
authRouter.post('/org-admin/login', authLimiter, validateBody(portalLoginSchema), controller.orgAdminLogin);
authRouter.post('/super-admin/login', authLimiter, validateBody(superAdminLoginSchema), controller.superAdminLogin);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, validateBody(changePasswordSchema), controller.changePassword);

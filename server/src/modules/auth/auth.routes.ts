import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
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

authRouter.post('/students/register', authLimiter, validateBody(studentRegistrationSchema), controller.registerStudent);
authRouter.get('/registration-options', registrationOptionsLimiter, controller.registrationOptions);
authRouter.post('/students/registration-status', registrationStatusLimiter, validateBody(registrationStatusSchema), controller.studentRegistrationStatus);
authRouter.post('/instructors/register', authLimiter, controller.deprecatedInstructorRegistration);
authRouter.post('/tutors/register', authLimiter, validateBody(tutorRegistrationSchema), controller.registerTutor);
authRouter.post('/students/login', authLimiter, validateBody(studentLoginSchema), controller.studentLogin);
authRouter.post('/instructors/login', authLimiter, controller.deprecatedInstructorLogin);
authRouter.post('/tutors/login', authLimiter, validateBody(tutorLoginSchema), controller.tutorLogin);
authRouter.post('/org-admin/login', authLimiter, validateBody(portalLoginSchema), controller.orgAdminLogin);
authRouter.post('/super-admin/login', authLimiter, validateBody(superAdminLoginSchema), controller.superAdminLogin);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, validateBody(changePasswordSchema), controller.changePassword);

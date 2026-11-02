import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import * as controller from './auth.controller.js';
import {
  instructorRegistrationSchema,
  changePasswordSchema,
  portalLoginSchema,
  staffLoginSchema,
  staffRegistrationSchema,
  studentLoginSchema,
  studentRegistrationSchema,
  superAdminLoginSchema,
} from './auth.schemas.js';

export const authRouter = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

authRouter.post('/students/register', authLimiter, validateBody(studentRegistrationSchema), controller.registerStudent);
authRouter.post('/instructors/register', authLimiter, validateBody(instructorRegistrationSchema), controller.registerInstructor);
authRouter.post('/staff/register', authLimiter, validateBody(staffRegistrationSchema), controller.registerStaff);
authRouter.post('/students/login', authLimiter, validateBody(studentLoginSchema), controller.studentLogin);
authRouter.post('/instructors/login', authLimiter, validateBody(portalLoginSchema), controller.instructorLogin);
authRouter.post('/staff/login', authLimiter, validateBody(staffLoginSchema), controller.staffLogin);
authRouter.post('/org-admin/login', authLimiter, validateBody(portalLoginSchema), controller.orgAdminLogin);
authRouter.post('/super-admin/login', authLimiter, validateBody(superAdminLoginSchema), controller.superAdminLogin);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, validateBody(changePasswordSchema), controller.changePassword);

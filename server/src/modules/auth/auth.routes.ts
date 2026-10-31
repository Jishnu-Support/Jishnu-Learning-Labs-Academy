import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { portalLoginSchema, registrationSchema, studentLoginSchema } from './auth.schemas.js';

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

authRouter.post('/students/register', authLimiter, validateBody(registrationSchema), controller.registerStudent);
authRouter.post('/students/login', authLimiter, validateBody(studentLoginSchema), controller.studentLogin);
authRouter.post('/instructors/login', authLimiter, validateBody(portalLoginSchema), controller.portalLogin('INSTRUCTOR'));
authRouter.post('/staff/login', authLimiter, validateBody(portalLoginSchema), controller.portalLogin('STAFF'));
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
authRouter.get('/me', authenticate, controller.me);

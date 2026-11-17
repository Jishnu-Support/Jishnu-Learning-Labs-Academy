import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { approvalsRouter, orgAdminApprovalsRouter } from './modules/approvals/approvals.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { coursesRouter, studentCoursesRouter } from './modules/courses/courses.routes.js';
import { notesRouter } from './modules/notes/notes.routes.js';
import { mediaRouter, studentMediaRouter } from './modules/media/media.routes.js';
import { organizationAdminSettingsRouter, organizationsRouter, publicBrandRouter, superAdminOrganizationsRouter } from './modules/organizations/organizations.routes.js';
import { tutorRouter } from './modules/tutors/tutor.routes.js';
import { studentsRouter } from './modules/students/students.routes.js';
import { learningRouter } from './modules/learning/learning.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { publicStudentPortalRouter, studentPortalRouter } from './modules/student-portal/student-portal.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-src': ["'self'", 'https://www.youtube-nocookie.com', 'https://meet.jit.si'],
    },
  },
}));
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.use('/api/public', publicBrandRouter);
app.use('/api/public', publicStudentPortalRouter);
app.use('/api/auth', authRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/organizations/settings', organizationAdminSettingsRouter);
app.use('/api/super-admin/organizations', superAdminOrganizationsRouter);
app.use('/api/students', studentsRouter);
app.use('/api/tutors', tutorRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/student/courses', studentCoursesRouter);
app.use('/api/notes', notesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/student/media', studentMediaRouter);
app.use('/api/learning', learningRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/portal', studentPortalRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/tutor/registrations', approvalsRouter);
app.use('/api/org-admin', orgAdminApprovalsRouter);
app.use((_req, res) => res.status(404).json({ error: { message: 'Route not found' } }));
app.use(errorHandler);

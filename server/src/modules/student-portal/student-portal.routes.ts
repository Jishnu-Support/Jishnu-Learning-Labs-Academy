import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { selectActiveOrganizationForSuperAdmin } from '../../middleware/super-admin-organization.js';
import * as controller from './student-portal.controller.js';
import {
  courseIdSchema, createLibraryItemSchema, createSessionSchema, gameRatingSchema, libraryItemIdSchema,
  sessionAttendanceParamsSchema, sessionIdSchema, updateLibraryItemSchema, updateSessionSchema,
  verificationCodeSchema,
} from './student-portal.schemas.js';

const managers = [Role.TUTOR, Role.ORG_ADMIN, Role.SUPER_ADMIN] as const;
const libraryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const student = Router();
student.use(authenticate, requireOrganization, requireRoles(Role.STUDENT));
student.get('/sessions', controller.listSessions);
student.post('/sessions/:sessionId/join', validateParams(sessionIdSchema), controller.joinSession);
student.get('/attendance', controller.studentAttendance);
student.get('/library', controller.listLibrary);
student.get('/library/:itemId', validateParams(libraryItemIdSchema), controller.getLibraryItem);
student.get('/library/:itemId/content', validateParams(libraryItemIdSchema), controller.viewLibraryContent);
student.put('/library/:itemId/saved', validateParams(libraryItemIdSchema), controller.saveLibraryItem);
student.delete('/library/:itemId/saved', validateParams(libraryItemIdSchema), controller.saveLibraryItem);
student.get('/certificates', controller.studentCertificates);
student.get('/completed-courses', controller.studentCompletedCourses);
student.post('/courses/:courseId/certificate', validateParams(courseIdSchema), controller.issueStudentCertificate);
student.get('/knowledge', controller.studentKnowledge);
student.get('/reports', controller.studentReports);
student.put('/knowledge/ratings', validateBody(gameRatingSchema), controller.rateKnowledgeGame);

const managerRoutes = Router();
managerRoutes.get('/sessions', controller.listSessions);
managerRoutes.post('/sessions', validateBody(createSessionSchema), controller.createSession);
managerRoutes.patch('/sessions/:sessionId', validateParams(sessionIdSchema), validateBody(updateSessionSchema), controller.updateSession);
managerRoutes.post('/sessions/:sessionId/cancel', validateParams(sessionIdSchema), controller.cancelSession);
managerRoutes.post('/sessions/:sessionId/start', validateParams(sessionIdSchema), controller.startSession);
managerRoutes.post('/sessions/:sessionId/host', validateParams(sessionIdSchema), controller.hostSession);
managerRoutes.get('/sessions/:sessionId/attendees', validateParams(sessionIdSchema), controller.attendees);
managerRoutes.put('/sessions/:sessionId/attendance/:studentId', validateParams(sessionAttendanceParamsSchema), controller.markAttendance);
managerRoutes.get('/library', controller.listLibrary);
managerRoutes.post('/library', libraryUpload.single('file'), validateBody(createLibraryItemSchema), controller.createLibraryItem);
managerRoutes.get('/library/:itemId', validateParams(libraryItemIdSchema), controller.getLibraryItem);
managerRoutes.get('/library/:itemId/content', validateParams(libraryItemIdSchema), controller.viewLibraryContent);
managerRoutes.patch('/library/:itemId', validateParams(libraryItemIdSchema), validateBody(updateLibraryItemSchema), controller.updateLibraryItem);
managerRoutes.delete('/library/:itemId', validateParams(libraryItemIdSchema), controller.deleteLibraryItem);

const manager = Router();
manager.use(authenticate, requireOrganization, requireRoles(...managers), managerRoutes);

export const studentPortalRouter = Router();
studentPortalRouter.use('/student', student);
studentPortalRouter.use('/manage', manager);

export const superAdminStudentPortalRouter = Router({ mergeParams: true });
superAdminStudentPortalRouter.use(
  authenticate,
  requireRoles(Role.SUPER_ADMIN),
  selectActiveOrganizationForSuperAdmin,
);
superAdminStudentPortalRouter.use('/manage', managerRoutes);

export const publicStudentPortalRouter = Router();
publicStudentPortalRouter.get('/certificates/:verificationCode', validateParams(verificationCodeSchema), controller.publicCertificate);

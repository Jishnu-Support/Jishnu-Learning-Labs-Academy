import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './student-portal.controller.js';
import {
  createLibraryItemSchema, createSessionSchema, gameRatingSchema, libraryItemIdSchema,
  sessionAttendanceParamsSchema, sessionIdSchema, updateLibraryItemSchema, updateSessionSchema, verificationCodeSchema,
} from './student-portal.schemas.js';

const managers = [Role.TUTOR, Role.ORG_ADMIN] as const;
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
student.get('/knowledge', controller.studentKnowledge);
student.get('/reports', controller.studentReports);
student.put('/knowledge/ratings', validateBody(gameRatingSchema), controller.rateKnowledgeGame);

const manager = Router();
manager.use(authenticate, requireOrganization, requireRoles(...managers));
manager.get('/sessions', controller.listSessions);
manager.post('/sessions', validateBody(createSessionSchema), controller.createSession);
manager.patch('/sessions/:sessionId', validateParams(sessionIdSchema), validateBody(updateSessionSchema), controller.updateSession);
manager.post('/sessions/:sessionId/cancel', validateParams(sessionIdSchema), controller.cancelSession);
manager.post('/sessions/:sessionId/start', validateParams(sessionIdSchema), controller.startSession);
manager.post('/sessions/:sessionId/host', validateParams(sessionIdSchema), controller.hostSession);
manager.get('/sessions/:sessionId/attendees', validateParams(sessionIdSchema), controller.attendees);
manager.put('/sessions/:sessionId/attendance/:studentId', validateParams(sessionAttendanceParamsSchema), controller.markAttendance);
manager.get('/library', controller.listLibrary);
manager.post('/library', libraryUpload.single('file'), validateBody(createLibraryItemSchema), controller.createLibraryItem);
manager.get('/library/:itemId', validateParams(libraryItemIdSchema), controller.getLibraryItem);
manager.get('/library/:itemId/content', validateParams(libraryItemIdSchema), controller.viewLibraryContent);
manager.patch('/library/:itemId', validateParams(libraryItemIdSchema), validateBody(updateLibraryItemSchema), controller.updateLibraryItem);
manager.delete('/library/:itemId', validateParams(libraryItemIdSchema), controller.deleteLibraryItem);

export const studentPortalRouter = Router();
studentPortalRouter.use('/student', student);
studentPortalRouter.use('/manage', manager);

export const publicStudentPortalRouter = Router();
publicStudentPortalRouter.get('/certificates/:verificationCode', validateParams(verificationCodeSchema), controller.publicCertificate);

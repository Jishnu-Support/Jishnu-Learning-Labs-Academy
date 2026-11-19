import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { selectActiveOrganizationForSuperAdmin } from '../../middleware/super-admin-organization.js';
import * as controller from './courses.controller.js';
import {
  courseIdSchema,
  createCourseSchema,
  createTopicSchema,
  enrollmentIdSchema,
  reorderTopicsSchema,
  topicIdSchema,
  updateCourseSchema,
  updateTopicSchema,
} from './courses.schemas.js';

const courseEditors = [Role.ORG_ADMIN, Role.TUTOR] as const;
const studentRouter = Router();

export const coursesRouter = Router();
coursesRouter.use(authenticate, requireOrganization, requireRoles(...courseEditors));
coursesRouter.get('/', controller.list);
coursesRouter.get('/faculty', controller.instructors);
coursesRouter.post('/', requireRoles(Role.ORG_ADMIN), validateBody(createCourseSchema), controller.create);
coursesRouter.get('/:courseId/enrollments', validateParams(courseIdSchema), controller.enrollments);
coursesRouter.post('/:courseId/enrollments/:enrollmentId/approve', validateParams(enrollmentIdSchema), controller.approveEnrollment);
coursesRouter.post('/:courseId/topics', validateParams(courseIdSchema), validateBody(createTopicSchema), controller.addTopic);
coursesRouter.patch('/:courseId/topics/reorder', validateParams(courseIdSchema), validateBody(reorderTopicsSchema), controller.reorderTopics);
coursesRouter.patch('/:courseId/topics/:topicId', validateParams(topicIdSchema), validateBody(updateTopicSchema), controller.updateTopic);
coursesRouter.get('/:courseId', validateParams(courseIdSchema), controller.get);
coursesRouter.patch('/:courseId', validateParams(courseIdSchema), validateBody(updateCourseSchema), controller.update);
coursesRouter.post('/:courseId/publish', validateParams(courseIdSchema), controller.publish);
coursesRouter.post('/:courseId/archive', validateParams(courseIdSchema), controller.archive);

studentRouter.use(authenticate, requireOrganization, requireRoles(Role.STUDENT));
studentRouter.get('/browse', controller.studentBrowse);
studentRouter.get('/enrolled', controller.studentEnrolled);
studentRouter.post('/:courseId/enroll', validateParams(courseIdSchema), controller.studentEnroll);
studentRouter.post('/:courseId/drop', validateParams(courseIdSchema), controller.studentDrop);
studentRouter.get('/:courseId', validateParams(courseIdSchema), controller.studentGet);

export const studentCoursesRouter = studentRouter;

export const superAdminCoursesRouter = Router({ mergeParams: true });
superAdminCoursesRouter.use(
  authenticate,
  requireRoles(Role.SUPER_ADMIN),
  selectActiveOrganizationForSuperAdmin,
);
superAdminCoursesRouter.get('/', controller.list);
superAdminCoursesRouter.get('/faculty', controller.instructors);
superAdminCoursesRouter.post('/', validateBody(createCourseSchema), controller.create);
superAdminCoursesRouter.get('/:courseId', validateParams(courseIdSchema), controller.get);
superAdminCoursesRouter.patch('/:courseId', validateParams(courseIdSchema), validateBody(updateCourseSchema), controller.update);
superAdminCoursesRouter.post('/:courseId/publish', validateParams(courseIdSchema), controller.publish);
superAdminCoursesRouter.post('/:courseId/archive', validateParams(courseIdSchema), controller.archive);
superAdminCoursesRouter.get('/:courseId/enrollments', validateParams(courseIdSchema), controller.enrollments);
superAdminCoursesRouter.post('/:courseId/enrollments/:enrollmentId/approve', validateParams(enrollmentIdSchema), controller.approveEnrollment);
superAdminCoursesRouter.post('/:courseId/topics', validateParams(courseIdSchema), validateBody(createTopicSchema), controller.addTopic);
superAdminCoursesRouter.patch('/:courseId/topics/reorder', validateParams(courseIdSchema), validateBody(reorderTopicsSchema), controller.reorderTopics);
superAdminCoursesRouter.patch('/:courseId/topics/:topicId', validateParams(topicIdSchema), validateBody(updateTopicSchema), controller.updateTopic);

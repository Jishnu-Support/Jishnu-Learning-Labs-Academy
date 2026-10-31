import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './courses.controller.js';
import { courseIdSchema, createCourseSchema, updateCourseSchema } from './courses.schemas.js';

export const coursesRouter = Router();
coursesRouter.use(authenticate, requireRoles(Role.INSTRUCTOR));
coursesRouter.get('/', controller.list);
coursesRouter.post('/', validateBody(createCourseSchema), controller.create);
coursesRouter.get('/:courseId', validateParams(courseIdSchema), controller.get);
coursesRouter.patch('/:courseId', validateParams(courseIdSchema), validateBody(updateCourseSchema), controller.update);
coursesRouter.post('/:courseId/publish', validateParams(courseIdSchema), controller.publish);
coursesRouter.post('/:courseId/unpublish', validateParams(courseIdSchema), controller.unpublish);
coursesRouter.delete('/:courseId', validateParams(courseIdSchema), controller.remove);

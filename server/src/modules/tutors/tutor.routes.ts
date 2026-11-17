import { Router } from 'express';
import multer from 'multer';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';
import * as controller from './tutor.controller.js';
import {
  createTutorSchema, deleteTutorReviewSchema, hideTutorReviewSchema, preferredTutorSchema, tutorCourseQuerySchema, tutorParamSchema,
  tutorReviewSchema, updateTutorSchema,
} from './tutor.schemas.js';

export const tutorRouter = Router();
tutorRouter.use(authenticate, requireOrganization);
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mapUploadError: import('express').ErrorRequestHandler = (error, _req, _res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(new HttpError(413, 'Profile photos must be no larger than 5 MB'));
    return;
  }
  next(error);
};
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
tutorRouter.get('/available', requireRoles(Role.STUDENT), validateQuery(tutorCourseQuerySchema), controller.available);
tutorRouter.get('/preferred', requireRoles(Role.STUDENT), validateQuery(tutorCourseQuerySchema), controller.preferred);
tutorRouter.put('/preferred', requireRoles(Role.STUDENT), validateBody(preferredTutorSchema), controller.selectPreferred);
tutorRouter.get('/reviews', requireRoles(Role.ORG_ADMIN), controller.organizationReviews);
tutorRouter.put('/reviews/:reviewId/visibility', requireRoles(Role.ORG_ADMIN), validateBody(hideTutorReviewSchema), controller.setReviewVisibility);
tutorRouter.put('/:userId/review', requireRoles(Role.STUDENT), reviewLimiter, validateParams(tutorParamSchema), validateBody(tutorReviewSchema), controller.submitReview);
tutorRouter.delete('/:userId/review', requireRoles(Role.STUDENT), reviewLimiter, validateParams(tutorParamSchema), validateBody(deleteTutorReviewSchema), controller.deleteReview);
tutorRouter.get('/:userId/reviews', requireRoles(Role.ORG_ADMIN, Role.TUTOR), validateParams(tutorParamSchema), controller.reviews);
tutorRouter.get('/', requireRoles(Role.ORG_ADMIN, Role.TUTOR), controller.list);
tutorRouter.get('/:userId/photo', validateParams(tutorParamSchema), controller.photo);
tutorRouter.get('/:userId', requireRoles(Role.ORG_ADMIN, Role.TUTOR), validateParams(tutorParamSchema), controller.get);
tutorRouter.get('/:userId/ratings', requireRoles(Role.TUTOR, Role.ORG_ADMIN), validateParams(tutorParamSchema), validateQuery(tutorCourseQuerySchema), controller.ratingDashboard);
tutorRouter.post('/', requireRoles(Role.ORG_ADMIN), validateBody(createTutorSchema), controller.create);
tutorRouter.put('/:userId/photo', requireRoles(Role.ORG_ADMIN, Role.TUTOR), validateParams(tutorParamSchema), photoUpload.single('photo'), mapUploadError, controller.uploadPhoto);
tutorRouter.patch('/:userId', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), validateBody(updateTutorSchema), controller.update);
tutorRouter.post('/:userId/suspend', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), controller.suspend);
tutorRouter.post('/:userId/reactivate', requireRoles(Role.ORG_ADMIN), validateParams(tutorParamSchema), controller.reactivate);

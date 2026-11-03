import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { env } from '../../config/env.js';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './media.controller.js';
import {
  mediaAssetParamsSchema,
  mediaIdSchema,
  mediaRenditionParamsSchema,
  studentMediaProgressSchema,
  updateMediaSchema,
} from './media.schemas.js';

const mediaManagers = [Role.STAFF, Role.INSTRUCTOR, Role.ORG_ADMIN] as const;
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export const mediaRouter = Router();
mediaRouter.use(authenticate, requireOrganization, requireRoles(...mediaManagers));
mediaRouter.get('/limits', controller.limits);
mediaRouter.get('/courses', controller.courses);
mediaRouter.get('/storage', requireRoles(Role.ORG_ADMIN), controller.storage);
mediaRouter.get('/', controller.list);
mediaRouter.post('/', uploadLimiter, controller.create);
mediaRouter.put('/:mediaId/file', uploadLimiter, validateParams(mediaIdSchema), controller.upload);
mediaRouter.get('/:mediaId/key', validateParams(mediaIdSchema), controller.key);
mediaRouter.get('/:mediaId/stream/:rendition/:asset', validateParams(mediaRenditionParamsSchema), controller.streamRenditionAsset);
mediaRouter.get('/:mediaId/stream/:asset', validateParams(mediaAssetParamsSchema), controller.streamAsset);
mediaRouter.patch('/:mediaId', validateParams(mediaIdSchema), validateBody(updateMediaSchema), controller.update);
mediaRouter.post('/:mediaId/publish', validateParams(mediaIdSchema), controller.publish);
mediaRouter.post('/:mediaId/unpublish', validateParams(mediaIdSchema), controller.unpublish);
mediaRouter.post('/:mediaId/retry', validateParams(mediaIdSchema), controller.retry);
mediaRouter.post('/:mediaId/cancel', validateParams(mediaIdSchema), controller.cancel);
mediaRouter.delete('/:mediaId', validateParams(mediaIdSchema), controller.remove);

export const studentMediaRouter = Router();
studentMediaRouter.use(authenticate, requireOrganization, requireRoles(Role.STUDENT));
studentMediaRouter.get('/', controller.listStudentMedia);
studentMediaRouter.get('/:mediaId', validateParams(mediaIdSchema), controller.getStudentMedia);
studentMediaRouter.post('/:mediaId/progress', validateParams(mediaIdSchema), validateBody(studentMediaProgressSchema), controller.recordStudentProgress);
studentMediaRouter.get('/:mediaId/stream/:asset', validateParams(mediaAssetParamsSchema), controller.streamStudentAsset);

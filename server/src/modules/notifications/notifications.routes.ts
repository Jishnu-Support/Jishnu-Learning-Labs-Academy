import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './notifications.controller.js';
import { notificationParamSchema, notificationPreferenceSchema } from './notifications.schemas.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', controller.list);
notificationsRouter.get('/events', controller.stream);
notificationsRouter.post('/read-all', controller.markAllRead);
notificationsRouter.get('/preferences', controller.preferences);
notificationsRouter.put('/preferences', validateBody(notificationPreferenceSchema), controller.updatePreferences);
notificationsRouter.post('/:notificationId/read', validateParams(notificationParamSchema), controller.markRead);
notificationsRouter.delete('/:notificationId', validateParams(notificationParamSchema), controller.remove);

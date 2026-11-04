import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { notificationListSchema } from './notifications.schemas.js';
import * as service from './notifications.service.js';

function authenticatedUserId(req: Request) {
  return req.auth!.userId;
}

export const list: RequestHandler = async (req, res) => {
  res.json({ data: await service.listNotifications(getOrganizationId(req), authenticatedUserId(req), req.auth!.role, notificationListSchema.parse(req.query)) });
};

export const markRead: RequestHandler = async (req, res) => {
  res.json({ data: { notification: await service.markNotificationRead(getOrganizationId(req), authenticatedUserId(req), req.auth!.role, req.params.notificationId as string) } });
};

export const markAllRead: RequestHandler = async (req, res) => {
  res.json({ data: await service.markAllNotificationsRead(getOrganizationId(req), authenticatedUserId(req), req.auth!.role) });
};

export const remove: RequestHandler = async (req, res) => {
  await service.deleteNotification(getOrganizationId(req), authenticatedUserId(req), req.auth!.role, req.params.notificationId as string);
  res.status(204).end();
};

export const preferences: RequestHandler = async (req, res) => {
  res.json({ data: { preferences: await service.getNotificationPreferences(getOrganizationId(req), authenticatedUserId(req), req.auth!.role) } });
};

export const updatePreferences: RequestHandler = async (req, res) => {
  const result = await service.updateNotificationPreferences(getOrganizationId(req), authenticatedUserId(req), req.auth!.role, req.body);
  res.json({ data: { preferences: result } });
};

export const stream: RequestHandler = (req, res) => {
  const userId = authenticatedUserId(req);
  const organizationId = getOrganizationId(req);
  if (!organizationId && req.auth!.role !== 'SUPER_ADMIN') {
    res.status(403).end();
    return;
  }
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  const unsubscribe = service.subscribeToNotifications(organizationId, userId, (notification) => {
    res.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
  });
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

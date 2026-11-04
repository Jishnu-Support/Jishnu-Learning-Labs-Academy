import { EventEmitter } from 'node:events';
import { NotificationType, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

export type NotificationPayload = {
  type: NotificationType;
  courseId?: string;
  title: string;
  body: string;
  link?: string;
  groupKey?: string;
  dedupeKey?: string;
};

const events = new EventEmitter();
events.setMaxListeners(0);

const categoryByType: Record<NotificationType, string> = {
  CONTENT_PUBLISHED: 'CONTENT',
  SESSION_SCHEDULED: 'SESSIONS',
  SESSION_REMINDER: 'SESSIONS',
  ASSESSMENT_PUBLISHED: 'ASSESSMENTS',
  ASSESSMENT_CLOSING: 'ASSESSMENTS',
  ASSESSMENT_RESULTS: 'ASSESSMENTS',
  ACCOUNT_PENDING: 'ACCOUNT',
  ACCOUNT_STATUS: 'ACCOUNT',
  REQUEST_STATUS: 'REQUESTS',
  PAYMENT_STATUS: 'PAYMENTS',
  SUBSCRIPTION_STATUS: 'SUBSCRIPTIONS',
  CERTIFICATE_ISSUED: 'CERTIFICATES',
  ATTENDANCE_ALERT: 'ATTENDANCE',
  CLASS_BOOKED: 'CLASSES',
  PAYOUT_RECORDED: 'PAYOUTS',
  SYSTEM: 'SYSTEM',
};

export function notificationEventName(organizationId: string | null, userId: string) {
  return `${organizationId ?? 'platform'}:${userId}`;
}

export function subscribeToNotifications(organizationId: string | null, userId: string, listener: (item: unknown) => void) {
  const eventName = notificationEventName(organizationId, userId);
  events.on(eventName, listener);
  return () => events.off(eventName, listener);
}

export async function notifyUsers(organizationId: string, userIds: string[], payload: NotificationPayload) {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return 0;
  const category = categoryByType[payload.type];
  const [users, disabledPreferences] = await prisma.$transaction([
    prisma.user.findMany({
      where: { organizationId, id: { in: uniqueIds }, isActive: true, status: 'APPROVED' },
      select: { id: true },
    }),
    prisma.notificationPreference.findMany({
      where: { organizationId, userId: { in: uniqueIds }, category, enabled: false },
      select: { userId: true },
    }),
  ]);
  const disabledIds = new Set(disabledPreferences.map(({ userId }) => userId));
  const recipients = users.filter(({ id }) => !disabledIds.has(id));
  if (!recipients.length) return 0;

  const now = new Date();
  if (payload.type === NotificationType.CONTENT_PUBLISHED && payload.groupKey) {
    const course = payload.courseId
      ? await prisma.course.findFirst({
        where: { id: payload.courseId, organizationId },
        select: { title: true },
      })
      : null;
    let updatedCount = 0;
    for (const recipient of recipients) {
      if (payload.dedupeKey) {
        const duplicate = await prisma.notification.findFirst({
          where: { organizationId, userId: recipient.id, dedupeKey: payload.dedupeKey },
          select: { id: true },
        });
        if (duplicate) continue;
      }
      const recent = await prisma.notification.findFirst({
        where: {
          organizationId,
          userId: recipient.id,
          type: NotificationType.CONTENT_PUBLISHED,
          groupKey: payload.groupKey,
          createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, groupCount: true },
      });
      if (recent) {
        const updated = await prisma.notification.update({
          where: { id: recent.id },
          data: {
            groupCount: recent.groupCount + 1,
            title: `${recent.groupCount + 1} new items${course ? ` in ${course.title}` : ''}`,
            body: course ? `New learning content is available in ${course.title}.` : 'New learning content is available.',
            createdAt: now,
            dedupeKey: payload.dedupeKey,
          },
        });
        events.emit(notificationEventName(organizationId, recipient.id), updated);
      } else {
        const created = await prisma.notification.create({
          data: {
            organizationId,
            userId: recipient.id,
            type: payload.type,
            courseId: payload.courseId,
            title: payload.title,
            body: payload.body,
            link: payload.link,
            groupKey: payload.groupKey,
            dedupeKey: payload.dedupeKey,
          },
        });
        events.emit(notificationEventName(organizationId, recipient.id), created);
      }
      updatedCount += 1;
    }
    return updatedCount;
  }

  const created = await prisma.notification.createMany({
    data: recipients.map(({ id }) => ({
      organizationId,
      userId: id,
      type: payload.type,
      courseId: payload.courseId,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      groupKey: payload.groupKey,
      dedupeKey: payload.dedupeKey,
    })),
    skipDuplicates: true,
  });
  if (created.count === 0) return 0;

  const fresh = await prisma.notification.findMany({
    where: {
      organizationId,
      userId: { in: recipients.map(({ id }) => id) },
      type: payload.type,
      title: payload.title,
      body: payload.body,
      createdAt: { gte: new Date(now.getTime() - 3000) },
      ...(payload.dedupeKey ? { dedupeKey: payload.dedupeKey } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: recipients.length,
  });
  for (const notification of fresh) {
    events.emit(notificationEventName(organizationId, notification.userId), notification);
  }
  return created.count;
}

export async function notifyAfterCommit(delivery: () => Promise<unknown>, context: string): Promise<void> {
  try {
    await delivery();
  } catch (error) {
    logger.error({ err: error, context }, 'Notification delivery failed after the primary action committed');
  }
}

export async function notifyCourseStudents(
  organizationId: string,
  courseId: string,
  payload: Omit<NotificationPayload, 'groupKey'> & { groupKey?: string },
) {
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationId, courseId, status: 'ACTIVE', student: { is: { organizationId, status: 'APPROVED', isActive: true } } },
    select: { studentId: true },
  });
  return notifyUsers(organizationId, enrollments.map(({ studentId }) => studentId), {
    ...payload,
    courseId,
    groupKey: payload.groupKey ?? `course:${courseId}`,
  });
}

export async function notifyOrganizationStudents(organizationId: string, payload: NotificationPayload) {
  const students = await prisma.user.findMany({
    where: { organizationId, role: 'STUDENT', status: 'APPROVED', isActive: true },
    select: { id: true },
  });
  return notifyUsers(organizationId, students.map(({ id }) => id), payload);
}

export async function listNotifications(
  organizationId: string | null,
  userId: string,
  role: Role,
  input: { page: number; pageSize: number; unreadOnly: boolean; type?: NotificationType },
) {
  const tenantId = requireScope(organizationId, role);
  const where: Prisma.NotificationWhereInput = {
    organizationId: tenantId,
    userId,
    ...(input.unreadOnly ? { readAt: null } : {}),
    ...(input.type ? { type: input.type } : {}),
  };
  const [notifications, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { organizationId: tenantId, userId, readAt: null } }),
  ]);
  return { notifications, pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }, unreadCount };
}

export async function markNotificationRead(organizationId: string | null, userId: string, role: Role, notificationId: string) {
  const tenantId = requireScope(organizationId, role);
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, organizationId: tenantId, userId },
    data: { readAt: new Date() },
  });
  if (!result.count) throw new HttpError(404, 'Notification not found');
  return prisma.notification.findFirstOrThrow({ where: { id: notificationId, organizationId: tenantId, userId } });
}

export async function markAllNotificationsRead(organizationId: string | null, userId: string, role: Role) {
  const tenantId = requireScope(organizationId, role);
  const result = await prisma.notification.updateMany({
    where: { organizationId: tenantId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

export async function deleteNotification(organizationId: string | null, userId: string, role: Role, notificationId: string) {
  const tenantId = requireScope(organizationId, role);
  const result = await prisma.notification.deleteMany({ where: { id: notificationId, organizationId: tenantId, userId } });
  if (!result.count) throw new HttpError(404, 'Notification not found');
}

export async function getNotificationPreferences(organizationId: string | null, userId: string, role: Role) {
  const tenantId = requireScope(organizationId, role);
  const stored = await prisma.notificationPreference.findMany({ where: { organizationId: tenantId, userId } });
  const enabled = new Map(stored.map(({ category, enabled }) => [category, enabled]));
  return ['CONTENT', 'SESSIONS', 'ASSESSMENTS', 'ACCOUNT', 'REQUESTS', 'PAYMENTS', 'SUBSCRIPTIONS', 'CERTIFICATES', 'ATTENDANCE', 'CLASSES', 'PAYOUTS', 'SYSTEM']
    .map((category) => ({ category, enabled: enabled.get(category) ?? true }));
}

export async function updateNotificationPreferences(
  organizationId: string | null,
  userId: string,
  role: Role,
  input: { preferences: Array<{ category: string; enabled: boolean }> },
) {
  const tenantId = requireScope(organizationId, role);
  if (tenantId) {
    await prisma.$transaction(input.preferences.map(({ category, enabled }) => prisma.notificationPreference.upsert({
      where: { organizationId_userId_category: { organizationId: tenantId, userId, category } },
      create: { organizationId: tenantId, userId, category, enabled },
      update: { enabled },
    })));
  } else {
    for (const { category, enabled } of input.preferences) {
      const current = await prisma.notificationPreference.findFirst({ where: { organizationId: null, userId, category }, select: { id: true } });
      if (current) await prisma.notificationPreference.update({ where: { id: current.id }, data: { enabled } });
      else await prisma.notificationPreference.create({ data: { organizationId: null, userId, category, enabled } });
    }
  }
  return getNotificationPreferences(tenantId, userId, role);
}

function requireScope(organizationId: string | null, role: Role) {
  if (!organizationId && role !== Role.SUPER_ADMIN) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

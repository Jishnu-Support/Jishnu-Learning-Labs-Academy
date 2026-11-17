import { NotificationType, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { notifyUsers } from '../notifications/notifications.service.js';

const reminderDays = [7, 3, 1] as const;

function localDayRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function runSubscriptionLifecycle(now = new Date()) {
  const expiringSubscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      endsAt: { gt: now },
      organization: { paymentsEnabled: true },
    },
    select: {
      id: true,
      organizationId: true,
      studentId: true,
      tutorId: true,
      course: { select: { title: true } },
      endsAt: true,
    },
    take: 1000,
  });

  for (const days of reminderDays) {
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    const { start, end } = localDayRange(target);
    for (const subscription of expiringSubscriptions.filter((item) => item.endsAt >= start && item.endsAt < end)) {
      await notifyUsers(subscription.organizationId, [subscription.studentId], {
        type: NotificationType.SUBSCRIPTION_STATUS,
        title: 'Subscription renewal reminder',
        body: `Your subscription for ${subscription.course.title} expires in ${days} day${days === 1 ? '' : 's'}.`,
        link: '/student/payments',
        dedupeKey: `subscription:${subscription.id}:expires:${days}d`,
      });
    }
  }

  const expiredSubscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      endsAt: { lte: now },
      organization: { paymentsEnabled: true },
    },
    select: {
      id: true,
      organizationId: true,
      studentId: true,
      tutorId: true,
      course: { select: { title: true } },
    },
    take: 1000,
  });

  for (const subscription of expiredSubscriptions) {
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.subscription.updateMany({
        where: { id: subscription.id, organizationId: subscription.organizationId, status: SubscriptionStatus.ACTIVE, endsAt: { lte: now } },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      if (result.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          organizationId: subscription.organizationId,
          actorId: null,
          action: 'SUBSCRIPTION_EXPIRED',
          targetType: 'Subscription',
          targetId: subscription.id,
          metadata: { courseTitle: subscription.course.title },
        },
      });
      return true;
    });
    if (!changed) continue;
    await notifyUsers(subscription.organizationId, [subscription.studentId, subscription.tutorId], {
      type: NotificationType.SUBSCRIPTION_STATUS,
      title: 'Subscription expired',
      body: `The subscription for ${subscription.course.title} has expired.`,
      link: '/student/payments',
      dedupeKey: `subscription:${subscription.id}:expired`,
    });
  }
}

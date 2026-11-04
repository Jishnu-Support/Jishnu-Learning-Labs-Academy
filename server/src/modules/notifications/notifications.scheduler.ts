import { NotificationType } from '@prisma/client';
import cron from 'node-cron';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { notifyUsers } from './notifications.service.js';

const lockName = 'notification-scheduler';
let running = false;

async function acquireLock() {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    INSERT INTO "NotificationSchedulerLock" ("name", "lockedUntil", "updatedAt")
    VALUES (${lockName}, NOW() + INTERVAL '50 seconds', NOW())
    ON CONFLICT ("name") DO UPDATE
    SET "lockedUntil" = NOW() + INTERVAL '50 seconds', "updatedAt" = NOW()
    WHERE "NotificationSchedulerLock"."lockedUntil" <= NOW()
    RETURNING "name"
  `;
  return rows.length === 1;
}

async function sessionAudience(organizationId: string, batchId: string | null, audienceType: string) {
  if (audienceType === 'BATCH' && batchId) {
    const members = await prisma.batchStudent.findMany({
      where: { organizationId, batchId, student: { is: { organizationId, status: 'APPROVED', isActive: true } } },
      select: { studentId: true },
    });
    return members.map(({ studentId }) => studentId);
  }
  const students = await prisma.user.findMany({
    where: { organizationId, role: 'STUDENT', status: 'APPROVED', isActive: true },
    select: { id: true },
  });
  return students.map(({ id }) => id);
}

async function createSessionReminders(now: Date) {
  const ranges = [
    { type: NotificationType.SESSION_REMINDER, key: '24h', start: new Date(now.getTime() + 23 * 60 * 60 * 1000), end: new Date(now.getTime() + 24 * 60 * 60 * 1000), label: 'in one day' },
    { type: NotificationType.SESSION_REMINDER, key: '1h', start: new Date(now.getTime() + 59 * 60 * 1000), end: new Date(now.getTime() + 60 * 60 * 1000), label: 'in one hour' },
    { type: NotificationType.SESSION_REMINDER, key: 'start', start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() + 60_000), label: 'now' },
  ];
  const scheduledSessions = await prisma.expertSession.findMany({
    where: { createdAt: { gt: new Date(now.getTime() - 60_000), lte: now }, startsAt: { gt: now } },
    select: { id: true, organizationId: true, batchId: true, audienceType: true, title: true },
    take: 100,
  });
  for (const range of ranges) {
    const sessions = await prisma.expertSession.findMany({
      where: { startsAt: { gt: range.start, lte: range.end } },
      select: { id: true, organizationId: true, batchId: true, audienceType: true, title: true },
      take: 100,
    });
    for (const session of sessions) {
      const users = await sessionAudience(session.organizationId, session.batchId, session.audienceType);
      await notifyUsers(session.organizationId, users, {
        type: range.type,
        title: range.key === 'start' ? 'Learning session starting now' : 'Upcoming learning session',
        body: range.key === 'start' ? `${session.title} is starting now.` : `${session.title} starts ${range.label}.`,
        link: '/student/online-classes',
        dedupeKey: `expert-session:${session.id}:reminder:${range.key}`,
      });
    }
    for (const session of scheduledSessions) {
      const users = await sessionAudience(session.organizationId, session.batchId, session.audienceType);
      await notifyUsers(session.organizationId, users, {
        type: NotificationType.SESSION_SCHEDULED,
        title: 'New learning session scheduled',
        body: `${session.title} has been scheduled.`,
        link: '/student/online-classes',
        dedupeKey: `expert-session:${session.id}:scheduled`,
      });
    }
  }
}

async function createAssessmentClosingReminders(now: Date) {
  const assessments = await prisma.assessment.findMany({
    where: {
      status: 'PUBLISHED',
      closesAt: { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    },
    select: { id: true, organizationId: true, courseId: true, title: true },
    take: 100,
  });
  for (const assessment of assessments) {
    const enrollment = await prisma.enrollment.findMany({
      where: { organizationId: assessment.organizationId, courseId: assessment.courseId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    await notifyUsers(assessment.organizationId, enrollment.map(({ studentId }) => studentId), {
      type: NotificationType.ASSESSMENT_CLOSING,
      title: 'Assessment closing soon',
      body: `${assessment.title} closes within 24 hours.`,
      link: '/student/assessments',
      dedupeKey: `assessment:${assessment.id}:closing`,
    });
  }
}

async function cleanupExpiredNotifications() {
  await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } } });
}

export async function runNotificationScheduler(now = new Date()) {
  if (running) return;
  running = true;
  let acquired = false;
  try {
    acquired = await acquireLock();
    if (!acquired) return;
    await createSessionReminders(now);
    await createAssessmentClosingReminders(now);
    await cleanupExpiredNotifications();
  } finally {
    try {
      if (acquired) {
        await prisma.notificationSchedulerLock.updateMany({ where: { name: lockName }, data: { lockedUntil: new Date() } });
      }
    } finally {
      running = false;
    }
  }
}

export function startNotificationScheduler() {
  const task = cron.schedule('* * * * *', () => {
    void runNotificationScheduler().catch((error: unknown) => logger.error({ err: error }, 'Notification scheduler run failed'));
  });
  void runNotificationScheduler().catch((error: unknown) => logger.error({ err: error }, 'Notification scheduler startup run failed'));
  return () => task.stop();
}

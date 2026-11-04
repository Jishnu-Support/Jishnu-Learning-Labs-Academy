import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
  NotificationType,
  OrganizationStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import { app } from '../src/app.js';
import {
  getNotificationPreferences,
  notifyCourseStudents,
  notifyUsers,
  subscribeToNotifications,
  updateNotificationPreferences,
} from '../src/modules/notifications/notifications.service.js';

const prisma = new PrismaClient();
const password = 'NotificationTest!123';
const prefix = `notifications-${Date.now()}`;
const organizationIds: string[] = [];

async function makeOrganization(suffix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`,
      code: `${prefix}-${suffix}`,
      headName: 'Notification Test Head',
      contactNumber: '+15555550100',
      email: `${prefix}-${suffix}@example.test`,
      address: '10 Test Street',
      city: 'Test City',
      state: 'Test State',
      country: 'Test Country',
      status: OrganizationStatus.ACTIVE,
    },
  });
  organizationIds.push(organization.id);
  return organization;
}

async function makeUser(organizationId: string, role: Role, suffix: string) {
  return prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name: `${suffix} Test`,
      role,
      status: AccountStatus.APPROVED,
    },
  });
}

async function login(organizationCode: string, email: string) {
  const response = await request(app).post('/api/auth/tutors/login').send({
    organizationCode,
    identifier: email,
    password,
  });
  expect(response.status).toBe(200);
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  const ids = [...new Set(organizationIds)];
  if (ids.length) {
    await prisma.notification.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.notificationPreference.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.enrollment.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe('in-app notifications', () => {
  it('limits fan-out and notification access to the recipient organization and user', async () => {
    const first = await makeOrganization('first');
    const second = await makeOrganization('second');
    const recipient = await makeUser(first.id, Role.TUTOR, 'recipient');
    const otherRecipient = await makeUser(first.id, Role.TUTOR, 'other-recipient');
    const otherTenantUser = await makeUser(second.id, Role.TUTOR, 'other-tenant');

    const delivered = await notifyUsers(first.id, [recipient.id, recipient.id, otherRecipient.id, otherTenantUser.id], {
      type: NotificationType.SYSTEM,
      title: 'System update',
      body: 'A new update is available.',
      dedupeKey: `${prefix}:tenant-isolation`,
    });
    expect(delivered).toBe(2);
    await notifyUsers(first.id, [recipient.id], {
      type: NotificationType.ACCOUNT_STATUS,
      title: 'Account status update',
      body: 'Your account status changed.',
      dedupeKey: `${prefix}:account-status`,
    });

    const recipientCookie = await login(first.code!, recipient.email);
    const otherTenantCookie = await login(second.code!, otherTenantUser.email);
    const recipientNotifications = await request(app).get('/api/notifications').set('Cookie', recipientCookie);
    expect(recipientNotifications.status).toBe(200);
    expect(recipientNotifications.body.data.notifications).toHaveLength(2);
    expect(recipientNotifications.body.data.unreadCount).toBe(2);
    const systemNotifications = await request(app).get('/api/notifications?type=SYSTEM').set('Cookie', recipientCookie);
    expect(systemNotifications.body.data.notifications).toHaveLength(1);
    expect(systemNotifications.body.data.notifications[0].type).toBe('SYSTEM');
    expect((await request(app).get('/api/notifications?type=INVALID').set('Cookie', recipientCookie)).status).toBe(400);

    const foreignNotificationId = systemNotifications.body.data.notifications[0].id as string;
    expect((await request(app).get('/api/notifications').set('Cookie', otherTenantCookie)).body.data.notifications).toHaveLength(0);
    expect((await request(app).post(`/api/notifications/${foreignNotificationId}/read`).set('Cookie', otherTenantCookie)).status).toBe(404);
    expect((await request(app).delete(`/api/notifications/${foreignNotificationId}`).set('Cookie', otherTenantCookie)).status).toBe(404);

    const marked = await request(app).post('/api/notifications/read-all').set('Cookie', recipientCookie);
    expect(marked.body.data.updated).toBe(2);
    expect((await request(app).get('/api/notifications?unreadOnly=true').set('Cookie', recipientCookie)).body.data.unreadCount).toBe(0);
  });

  it('respects disabled category preferences and publishes new items to SSE subscribers', async () => {
    const organization = await makeOrganization('preferences');
    const recipient = await makeUser(organization.id, Role.TUTOR, 'preferences-recipient');
    let received: unknown;
    const unsubscribe = subscribeToNotifications(organization.id, recipient.id, (item) => { received = item; });

    await updateNotificationPreferences(organization.id, recipient.id, Role.TUTOR, {
      preferences: [{ category: 'SYSTEM', enabled: false }],
    });
    expect((await notifyUsers(organization.id, [recipient.id], {
      type: NotificationType.SYSTEM,
      title: 'Disabled update',
      body: 'This update is disabled.',
      dedupeKey: `${prefix}:disabled`,
    }))).toBe(0);
    expect((await getNotificationPreferences(organization.id, recipient.id, Role.TUTOR))
      .find(({ category }) => category === 'SYSTEM')?.enabled).toBe(false);

    await updateNotificationPreferences(organization.id, recipient.id, Role.TUTOR, {
      preferences: [{ category: 'SYSTEM', enabled: true }],
    });
    expect((await notifyUsers(organization.id, [recipient.id], {
      type: NotificationType.SYSTEM,
      title: 'Enabled update',
      body: 'This update is enabled.',
      dedupeKey: `${prefix}:enabled`,
    }))).toBe(1);
    expect(received).toMatchObject({ title: 'Enabled update', userId: recipient.id });
    unsubscribe();
  });

  it('notifies only approved active students enrolled in the published course', async () => {
    const organization = await makeOrganization('course-audience');
    const otherOrganization = await makeOrganization('other-audience');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'course-tutor');
    const enrolled = await makeUser(organization.id, Role.STUDENT, 'enrolled-student');
    const notEnrolled = await makeUser(organization.id, Role.STUDENT, 'not-enrolled-student');
    const otherTenantStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'other-tenant-student');
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: `${prefix}-COURSE`,
        title: 'Notification course',
        category: 'Testing',
        plannedHours: 1,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: CourseStatus.PUBLISHED,
        createdById: tutor.id,
      },
    });
    await prisma.enrollment.create({
      data: { organizationId: organization.id, courseId: course.id, studentId: enrolled.id, status: EnrollmentStatus.ACTIVE },
    });

    expect(await notifyCourseStudents(organization.id, course.id, {
      type: NotificationType.CONTENT_PUBLISHED,
      title: 'New learning content',
      body: 'A new note is available.',
      groupKey: `course:${course.id}:content`,
      dedupeKey: `${prefix}:course-content`,
    })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, userId: enrolled.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, userId: notEnrolled.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: otherOrganization.id, userId: otherTenantStudent.id } })).toBe(0);
  });

  it('groups content published within the same course window', async () => {
    const organization = await makeOrganization('grouping');
    const recipient = await makeUser(organization.id, Role.STUDENT, 'grouping-recipient');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'grouping-tutor');
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: `${prefix}-GROUPED`,
        title: 'Python',
        category: 'Testing',
        plannedHours: 1,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        createdById: tutor.id,
      },
    });
    const groupKey = `${prefix}:course-content`;

    for (let index = 1; index <= 5; index += 1) {
      await notifyUsers(organization.id, [recipient.id], {
        type: NotificationType.CONTENT_PUBLISHED,
        title: `Learning item ${index}`,
        body: `Item ${index} is available.`,
        courseId: course.id,
        groupKey,
        dedupeKey: `${prefix}:grouped-item-${index}`,
      });
    }

    const grouped = await prisma.notification.findMany({ where: { organizationId: organization.id, userId: recipient.id } });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].groupCount).toBe(5);
    expect(grouped[0].title).toBe('5 new items in Python');
  });
});

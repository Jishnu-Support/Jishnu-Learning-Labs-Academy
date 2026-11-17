import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus, CourseStatus, EnrollmentStatus, MediaStatus, MediaType, MediaVisibility,
  OrganizationStatus, PaymentProviderKind, PaymentStatus, PrismaClient, Role, StudentStatus, SubscriptionPeriod, SubscriptionStatus,
} from '@prisma/client';
import { app } from '../src/app.js';
import { canAccessContent } from '../src/modules/student-portal/content-access.service.js';
import { getStudentMedia } from '../src/modules/media/media.service.js';
import { noteForView } from '../src/modules/notes/notes.service.js';
import { joinSession } from '../src/modules/student-portal/student-portal.service.js';
import { assertPaymentProviderAllowed, MockPaymentProvider } from '../src/modules/payments/payment.provider.js';
import { runSubscriptionLifecycle } from '../src/modules/payments/subscriptions.scheduler.js';

const prisma = new PrismaClient();
const password = 'PaymentTest!1234';
const prefix = `payments-${Date.now()}`;
const organizationIds: string[] = [];

async function makeOrganization(suffix: string, paymentsEnabled = true) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`,
      code: `${prefix}-${suffix}`,
      headName: 'Payments Test Head',
      contactNumber: '+15555550100',
      email: `${prefix}-${suffix}@example.test`,
      address: '10 Payments Street',
      city: 'Test City',
      state: 'Test State',
      country: 'United States',
      status: OrganizationStatus.ACTIVE,
      paymentsEnabled,
    },
  });
  organizationIds.push(organization.id);
  return organization;
}

async function makeUser(organizationId: string | null, role: Role, suffix: string) {
  return prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name: `${suffix} Test`,
      role,
      status: AccountStatus.APPROVED,
      isActive: true,
      ...(role === Role.STUDENT && organizationId ? {
        studentProfile: { create: { organizationId, studentId: `${prefix}-${suffix}`, status: StudentStatus.APPROVED } },
      } : {}),
      ...(role === Role.TUTOR && organizationId ? {
        tutorProfile: { create: { organizationId, tutorId: `${prefix}-${suffix}` } },
      } : {}),
    },
  });
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function loginStudent(organizationCode: string, studentId: string) {
  const response = await request(app).post('/api/auth/students/login').send({ organizationCode, studentId, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return cookieHeader(response);
}

async function loginTutor(organizationCode: string, tutorId: string) {
  const response = await request(app).post('/api/auth/tutors/login').send({ organizationCode, identifier: tutorId, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return cookieHeader(response);
}

async function loginOrgAdmin(organizationCode: string, email: string) {
  const response = await request(app).post('/api/auth/org-admin/login').send({ organizationCode, email, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return cookieHeader(response);
}

async function loginSuperAdmin(email: string) {
  const response = await request(app).post('/api/auth/super-admin/login').send({ email, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return cookieHeader(response);
}

describe('course fee payments and content access', () => {
  let organization: Awaited<ReturnType<typeof makeOrganization>>;
  let otherOrganization: Awaited<ReturnType<typeof makeOrganization>>;
  let tutor: Awaited<ReturnType<typeof makeUser>>;
  let student: Awaited<ReturnType<typeof makeUser>>;
  let otherStudent: Awaited<ReturnType<typeof makeUser>>;
  let reminderStudent: Awaited<ReturnType<typeof makeUser>>;
  let courseId: string;
  let planId: string;
  let paymentId: string;
  let studentCookie: string;
  let reminderStudentCookie: string;
  let otherStudentCookie: string;
  let tutorCookie: string;
  let otherTutorCookie: string;
  let orgAdminCookie: string;
  let otherOrgAdminCookie: string;
  let superAdminCookie: string;
  let orgAdmin: Awaited<ReturnType<typeof makeUser>>;
  let otherOrgAdmin: Awaited<ReturnType<typeof makeUser>>;
  let superAdmin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    await prisma.$connect();
    organization = await makeOrganization('primary');
    otherOrganization = await makeOrganization('other', false);
    await prisma.organization.update({
      where: { id: organization.id },
      data: { minimumMonthlyFee: 100, maximumMonthlyFee: 500, minimumQuarterlyFee: 300, maximumQuarterlyFee: 1500, minimumYearlyFee: 1000, maximumYearlyFee: 5000 },
    });
    tutor = await makeUser(organization.id, Role.TUTOR, 'tutor');
    student = await makeUser(organization.id, Role.STUDENT, 'student');
    reminderStudent = await makeUser(organization.id, Role.STUDENT, 'reminder-student');
    otherStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'other-student');
    await makeUser(organization.id, Role.TUTOR, 'unassigned-tutor');
    const otherOrgTutor = await makeUser(otherOrganization.id, Role.TUTOR, 'other-organization-tutor');
    orgAdmin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
    otherOrgAdmin = await makeUser(otherOrganization.id, Role.ORG_ADMIN, 'other-admin');
    superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'super-admin');
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: `${prefix}-COURSE`,
        title: 'Payment test course',
        category: 'Tests',
        plannedHours: 10,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: CourseStatus.PUBLISHED,
        createdById: tutor.id,
      },
    });
    courseId = course.id;
    await prisma.courseInstructor.create({ data: { organizationId: organization.id, courseId, instructorId: tutor.id } });
    await prisma.enrollment.create({ data: { organizationId: organization.id, courseId, studentId: student.id, status: EnrollmentStatus.ACTIVE } });
    const freeCourse = await prisma.course.create({
      data: {
        organizationId: otherOrganization.id,
        code: `${prefix}-FREE`,
        title: 'Payments disabled course',
        category: 'Tests',
        plannedHours: 1,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: CourseStatus.PUBLISHED,
        createdById: otherStudent.id,
      },
    });
    await prisma.courseInstructor.create({
      data: { organizationId: otherOrganization.id, courseId: freeCourse.id, instructorId: otherOrgTutor.id },
    });
    const otherPlan = await prisma.tutorCoursePlan.create({
      data: { organizationId: otherOrganization.id, tutorId: otherOrgTutor.id, courseId: freeCourse.id, period: SubscriptionPeriod.MONTHLY, price: 180 },
    });
    const otherSubscription = await prisma.subscription.create({
      data: {
        organizationId: otherOrganization.id,
        studentId: otherStudent.id,
        tutorId: otherOrgTutor.id,
        courseId: freeCourse.id,
        planId: otherPlan.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 86_400_000),
        periodsPaid: 1,
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: otherOrganization.id,
        studentId: otherStudent.id,
        tutorId: otherOrgTutor.id,
        courseId: freeCourse.id,
        planId: otherPlan.id,
        subscriptionId: otherSubscription.id,
        amount: 180,
        currency: 'INR',
        provider: PaymentProviderKind.MOCK,
        status: PaymentStatus.PAID,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000),
        periodsCount: 1,
        receiptNumber: `${prefix}-other-org-payment`,
      },
    });
    await prisma.enrollment.create({
      data: { organizationId: otherOrganization.id, courseId: freeCourse.id, studentId: otherStudent.id, status: EnrollmentStatus.ACTIVE },
    });
    await expect(canAccessContent({
      organizationId: otherOrganization.id, userId: otherStudent.id, role: Role.STUDENT,
      courseId: freeCourse.id, published: true,
    })).resolves.toBe(true);
    await prisma.tutorCoursePlan.create({
      data: {
        organizationId: organization.id, tutorId: tutor.id, courseId,
        period: SubscriptionPeriod.MONTHLY, price: '125.00',
      },
    }).then((plan) => { planId = plan.id; });
    await prisma.enrollment.create({
      data: { organizationId: organization.id, courseId, studentId: reminderStudent.id, status: EnrollmentStatus.ACTIVE },
    });
    const reminderEnd = new Date(Date.now());
    reminderEnd.setDate(reminderEnd.getDate() + 3);
    await prisma.subscription.create({
      data: {
        organizationId: organization.id, studentId: reminderStudent.id, tutorId: tutor.id, courseId,
        planId, status: SubscriptionStatus.ACTIVE, startsAt: new Date(), endsAt: reminderEnd, periodsPaid: 1,
      },
    });

    studentCookie = await loginStudent(organization.code!, `${prefix}-student`);
    reminderStudentCookie = await loginStudent(organization.code!, `${prefix}-reminder-student`);
    otherStudentCookie = await loginStudent(otherOrganization.code!, `${prefix}-other-student`);
    tutorCookie = await loginTutor(organization.code!, `${prefix}-tutor`);
    otherTutorCookie = await loginTutor(organization.code!, `${prefix}-unassigned-tutor`);
    orgAdminCookie = await loginOrgAdmin(organization.code!, orgAdmin.email);
    otherOrgAdminCookie = await loginOrgAdmin(otherOrganization.code!, otherOrgAdmin.email);
    superAdminCookie = await loginSuperAdmin(superAdmin.email);
  });

  afterAll(async () => {
    if (organizationIds.length) {
      await prisma.payment.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.note.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.mediaItem.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.expertSession.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.course.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    if (superAdmin!) await prisma.user.deleteMany({ where: { id: superAdmin.id } });
    await prisma.$disconnect();
  });

  it('keeps content locked for inactive and expired subscriptions, allows free previews, and enforces each content route', async () => {
    const actor = { organizationId: organization.id, userId: student.id, role: Role.STUDENT };
    const note = await prisma.note.create({
      data: {
        organizationId: organization.id, authorId: tutor.id, courseId, title: 'Fee gated note',
        subject: 'Tests', description: 'Payment gating fixture', published: true,
      },
    });
    const media = await prisma.mediaItem.create({
      data: {
        organizationId: organization.id, uploadedById: tutor.id, courseId,
        title: 'Fee gated media', type: MediaType.VIDEO, status: MediaStatus.READY,
        visibility: MediaVisibility.PUBLISHED,
      },
    });
    const session = await prisma.expertSession.create({
      data: {
        organizationId: organization.id, hostId: tutor.id, courseId, title: 'Fee gated class',
        description: '', roomName: `${prefix}-room`, startsAt: new Date(Date.now() - 2 * 60_000),
        durationMinutes: 45, status: 'LIVE',
      },
    });

    await expect(noteForView(organization.id, note.id, student.id, Role.STUDENT)).rejects.toMatchObject({ status: 402 });
    await expect(getStudentMedia(actor, media.id)).rejects.toMatchObject({ status: 402 });
    await expect(joinSession(actor, session.id)).rejects.toMatchObject({ status: 402 });
    await expect(canAccessContent({ organizationId: organization.id, userId: student.id, role: Role.STUDENT, courseId, published: true })).resolves.toBe(false);

    await prisma.note.update({ where: { id: note.id }, data: { freePreview: true } });
    await prisma.mediaItem.update({ where: { id: media.id }, data: { freePreview: true } });
    await prisma.expertSession.update({ where: { id: session.id }, data: { freePreview: true } });
    await expect(noteForView(organization.id, note.id, student.id, Role.STUDENT)).resolves.toMatchObject({ note: { id: note.id } });
    await expect(getStudentMedia(actor, media.id)).resolves.toMatchObject({ id: media.id });
    await expect(joinSession(actor, session.id)).resolves.toMatchObject({ sessionId: session.id });

    const plan = await prisma.tutorCoursePlan.findUniqueOrThrow({ where: { id: planId } });
    const endsAt = new Date(Date.now() + 10 * 60_000);
    await prisma.subscription.create({
      data: {
        organizationId: organization.id, studentId: student.id, tutorId: tutor.id, courseId,
        planId: plan.id, status: SubscriptionStatus.INACTIVE, startsAt: new Date(), endsAt,
        periodsPaid: 1, deactivatedBy: tutor.id, deactivationReason: 'Test inactive state',
      },
    });
    await expect(canAccessContent({ organizationId: organization.id, userId: student.id, role: Role.STUDENT, courseId, published: true })).resolves.toBe(false);
    await prisma.subscription.update({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: organization.id, studentId: student.id, tutorId: tutor.id, courseId } },
      data: { status: SubscriptionStatus.ACTIVE, endsAt: new Date(Date.now() - 60_000) },
    });
    await expect(canAccessContent({ organizationId: organization.id, userId: student.id, role: Role.STUDENT, courseId, published: true })).resolves.toBe(false);
    await expect(canAccessContent({ organizationId: otherOrganization.id, userId: student.id, role: Role.STUDENT, courseId, published: true })).resolves.toBe(false);
    await runSubscriptionLifecycle(new Date());
    const expired = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: organization.id, studentId: student.id, tutorId: tutor.id, courseId } },
    });
    expect(expired.status).toBe(SubscriptionStatus.EXPIRED);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetType: 'Subscription', targetId: expired.id, action: 'SUBSCRIPTION_EXPIRED' } })).not.toBeNull();
    const reminder = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: organization.id, studentId: reminderStudent.id, tutorId: tutor.id, courseId } },
    });
    expect(await prisma.notification.findFirst({
      where: { organizationId: organization.id, userId: reminderStudent.id, dedupeKey: `subscription:${reminder.id}:expires:3d` },
    })).not.toBeNull();
  });

  it('uses the server plan price, extends renewals, scopes receipts to their owner, and refuses MOCK in production', async () => {
    const oldEnd = new Date(Date.now() + 5 * 24 * 60 * 60_000);
    await prisma.subscription.upsert({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: organization.id, studentId: student.id, tutorId: tutor.id, courseId } },
      update: { status: SubscriptionStatus.ACTIVE, startsAt: new Date(), endsAt: oldEnd, periodsPaid: 1 },
      create: {
        organizationId: organization.id, studentId: student.id, tutorId: tutor.id, courseId, planId,
        status: SubscriptionStatus.ACTIVE, startsAt: new Date(), endsAt: oldEnd, periodsPaid: 1,
      },
    });
    const gatedNote = await prisma.note.findFirstOrThrow({ where: { organizationId: organization.id, courseId, title: 'Fee gated note' } });
    const gatedMedia = await prisma.mediaItem.findFirstOrThrow({ where: { organizationId: organization.id, courseId, title: 'Fee gated media' } });
    const gatedSession = await prisma.expertSession.findFirstOrThrow({ where: { organizationId: organization.id, courseId, title: 'Fee gated class' } });
    await prisma.note.update({ where: { id: gatedNote.id }, data: { freePreview: false } });
    await prisma.mediaItem.update({ where: { id: gatedMedia.id }, data: { freePreview: false } });
    await prisma.expertSession.update({ where: { id: gatedSession.id }, data: { freePreview: false } });
    await expect(noteForView(organization.id, gatedNote.id, student.id, Role.STUDENT)).resolves.toMatchObject({ note: { id: gatedNote.id } });
    await expect(getStudentMedia({ organizationId: organization.id, userId: student.id, role: Role.STUDENT }, gatedMedia.id)).resolves.toMatchObject({ id: gatedMedia.id });
    await expect(joinSession({ organizationId: organization.id, userId: student.id, role: Role.STUDENT }, gatedSession.id)).resolves.toMatchObject({ sessionId: gatedSession.id });
    const response = await request(app).post('/api/payments/student/checkout').set('Cookie', studentCookie).send({
      planId, periodsCount: 1, pin: '123456', amount: 0.01,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.payment.amount).toBe(125);
    expect(new Date(response.body.data.subscription.endsAt).getTime()).toBeGreaterThan(oldEnd.getTime());
    paymentId = response.body.data.payment.id as string;
    const failed = await request(app).post('/api/payments/student/checkout').set('Cookie', studentCookie).send({
      planId, periodsCount: 1, pin: '000000',
    });
    expect(failed.status).toBe(201);
    expect(failed.body.data.payment.status).toBe('FAILED');
    const retry = await request(app).post('/api/payments/student/checkout').set('Cookie', studentCookie).send({
      planId, periodsCount: 1, pin: '123456',
    });
    expect(retry.status).toBe(201);
    expect(retry.body.data.payment.status).toBe('PAID');

    const receipt = await request(app).get(`/api/payments/student/${paymentId}/receipt`).set('Cookie', studentCookie);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    expect((await request(app).get(`/api/payments/student/${paymentId}/receipt`).set('Cookie', otherStudentCookie)).status).toBe(404);
    expect(new MockPaymentProvider('test').kind).toBe('MOCK');
    expect(() => assertPaymentProviderAllowed('MOCK', 'production')).toThrow(/cannot be used in production/i);
    expect(() => new MockPaymentProvider('production')).toThrow(/cannot be used in production/i);
  });

  it('manages Tutor prices, tenant payment settings, subscriptions, refunds, exports, and platform access', async () => {
    const tutorData = await request(app).get('/api/payments/management').set('Cookie', tutorCookie);
    expect(tutorData.status).toBe(200);
    expect(tutorData.body.data.scope).toBe(Role.TUTOR);
    expect(tutorData.body.data.plans.every((plan: { tutorId: string }) => plan.tutorId === tutor.id)).toBe(true);

    const setPrice = await request(app).put('/api/payments/tutor/plans').set('Cookie', tutorCookie).send({
      courseId, period: SubscriptionPeriod.MONTHLY, price: 200,
    });
    expect(setPrice.status, JSON.stringify(setPrice.body)).toBe(200);
    expect(setPrice.body.data.price).toBe(200);
    const history = await prisma.tutorCoursePlanHistory.findMany({ where: { organizationId: organization.id, planId }, orderBy: { createdAt: 'desc' } });
    expect(history[0]?.previousPrice?.toNumber()).toBe(125);
    expect(history[0]?.newPrice.toNumber()).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetId: planId, action: 'TUTOR_PAYMENT_PLAN_PRICE_SET' } })).not.toBeNull();

    const overLimit = await request(app).put('/api/payments/tutor/plans').set('Cookie', tutorCookie).send({
      courseId, period: SubscriptionPeriod.MONTHLY, price: 501,
    });
    expect(overLimit.status).toBe(400);
    const wrongTutor = await request(app).put('/api/payments/tutor/plans').set('Cookie', otherTutorCookie).send({
      courseId, period: SubscriptionPeriod.MONTHLY, price: 200,
    });
    expect(wrongTutor.status).toBe(404);
    expect((await request(app).get('/api/payments/management').set('Cookie', studentCookie)).status).toBe(403);

    const adminView = await request(app).get('/api/payments/management').set('Cookie', orgAdminCookie);
    expect(adminView.status).toBe(200);
    expect(adminView.body.data.organization.id).toBe(organization.id);
    expect(adminView.body.data.payments.every((payment: { organization: { id: string } }) => payment.organization.id === organization.id)).toBe(true);
    const otherAdminView = await request(app).get('/api/payments/management').set('Cookie', otherOrgAdminCookie);
    expect(otherAdminView.status).toBe(200);
    expect(otherAdminView.body.data.payments).toHaveLength(1);
    expect(otherAdminView.body.data.payments[0].organization.id).toBe(otherOrganization.id);
    const superView = await request(app).get('/api/payments/management').set('Cookie', superAdminCookie);
    expect(superView.status).toBe(200);
    expect(superView.body.data.organizations.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([organization.id, otherOrganization.id]));
    expect(superView.body.data.payments.some((payment: { organization: { id: string } }) => payment.organization.id === organization.id)).toBe(true);
    expect(superView.body.data.payments.some((payment: { organization: { id: string } }) => payment.organization.id === otherOrganization.id)).toBe(true);
    expect(JSON.stringify(superView.body.data)).not.toMatch(/providerOrderId|providerPaymentId|upiId|cardNumber/i);

    const override = await request(app).put(`/api/payments/organization/plans/${planId}/price`).set('Cookie', orgAdminCookie).send({
      price: 220, reason: 'Approved tutor price adjustment',
    });
    expect(override.status).toBe(200);
    expect(override.body.data.price).toBe(220);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetId: planId, action: 'PAYMENT_PLAN_PRICE_OVERRIDDEN' } })).not.toBeNull();
    expect((await request(app).put(`/api/payments/organization/plans/${planId}/price`).set('Cookie', otherOrgAdminCookie).send({
      price: 230, reason: 'Wrong organization',
    })).status).toBe(404);

    const settings = await request(app).put('/api/payments/organization/settings').set('Cookie', orgAdminCookie).send({
      paymentsEnabled: true, currency: 'INR',
      minimumMonthlyFee: 100, maximumMonthlyFee: 500,
      minimumQuarterlyFee: 300, maximumQuarterlyFee: 1500,
      minimumYearlyFee: 1000, maximumYearlyFee: 5000,
      invoiceName: 'Test Invoice', invoiceAddress: 'Test address', invoiceTaxId: null,
    });
    expect(settings.status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, action: 'ORGANIZATION_PAYMENT_SETTINGS_UPDATED' } })).not.toBeNull();
    expect((await request(app).put('/api/payments/organization/settings').set('Cookie', orgAdminCookie).send({
      paymentsEnabled: true, currency: 'INR',
      minimumMonthlyFee: 500, maximumMonthlyFee: 100,
      minimumQuarterlyFee: null, maximumQuarterlyFee: null,
      minimumYearlyFee: null, maximumYearlyFee: null,
      invoiceName: null, invoiceAddress: null, invoiceTaxId: null,
    })).status).toBe(400);

    expect((await request(app).put(`/api/payments/organization/tutors/${tutor.id}/fee-acceptance`).set('Cookie', orgAdminCookie).send({
      acceptsNewFees: false,
    })).status).toBe(200);
    const rejectedCheckout = await request(app).post('/api/payments/student/checkout').set('Cookie', reminderStudentCookie).send({
      planId, periodsCount: 1, pin: '123456',
    });
    expect(rejectedCheckout.status).toBe(409);
    await request(app).put(`/api/payments/organization/tutors/${tutor.id}/fee-acceptance`).set('Cookie', orgAdminCookie).send({ acceptsNewFees: true });

    const reminderSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: organization.id, studentId: reminderStudent.id, tutorId: tutor.id, courseId } },
    });
    expect((await request(app).put(`/api/payments/subscriptions/${reminderSubscription.id}/status`).set('Cookie', studentCookie).send({
      status: SubscriptionStatus.INACTIVE, reason: 'Unauthorized student attempt',
    })).status).toBe(403);
    const deactivate = await request(app).put(`/api/payments/subscriptions/${reminderSubscription.id}/status`).set('Cookie', orgAdminCookie).send({
      status: SubscriptionStatus.INACTIVE, reason: 'Administrative review',
    });
    expect(deactivate.status).toBe(200);
    await expect(canAccessContent({
      organizationId: organization.id, userId: reminderStudent.id, role: Role.STUDENT, courseId, published: true,
    })).resolves.toBe(false);
    const reactivate = await request(app).put(`/api/payments/subscriptions/${reminderSubscription.id}/status`).set('Cookie', superAdminCookie).send({
      status: SubscriptionStatus.ACTIVE, reason: 'Access restored',
    });
    expect(reactivate.status).toBe(200);
    await expect(canAccessContent({
      organizationId: organization.id, userId: reminderStudent.id, role: Role.STUDENT, courseId, published: true,
    })).resolves.toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetId: reminderSubscription.id, action: 'SUBSCRIPTION_DEACTIVATED' } })).not.toBeNull();

    const refundCheckout = await request(app).post('/api/payments/student/checkout').set('Cookie', reminderStudentCookie).send({
      planId, periodsCount: 1, pin: '123456',
    });
    expect(refundCheckout.status).toBe(201);
    const refunded = await request(app).put(`/api/payments/organization/payments/${refundCheckout.body.data.payment.id}/refund`).set('Cookie', orgAdminCookie).send({
      reason: 'Duplicate demo payment',
    });
    expect(refunded.status).toBe(200);
    expect(refunded.body.data.status).toBe(PaymentStatus.REFUNDED);
    expect(refunded.body.data.subscriptionDeactivated).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetId: refundCheckout.body.data.payment.id, action: 'PAYMENT_REFUNDED' } })).not.toBeNull();
    expect((await request(app).put(`/api/payments/organization/payments/${refundCheckout.body.data.payment.id}/refund`).set('Cookie', otherOrgAdminCookie).send({
      reason: 'Wrong tenant',
    })).status).toBe(404);

    const csv = await request(app).get('/api/payments/management/export.csv?status=PAID').set('Cookie', orgAdminCookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Payment ID');

    expect((await request(app).put(`/api/payments/platform/organizations/${otherOrganization.id}/payments`).set('Cookie', orgAdminCookie).send({
      paymentsEnabled: true,
    })).status).toBe(403);
    const platformToggle = await request(app).put(`/api/payments/platform/organizations/${otherOrganization.id}/payments`).set('Cookie', superAdminCookie).send({
      paymentsEnabled: true,
    });
    expect(platformToggle.status).toBe(200);
    expect(platformToggle.body.data.paymentsEnabled).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { organizationId: otherOrganization.id, action: 'SUPER_ADMIN_ORGANIZATION_PAYMENTS_TOGGLED' } })).not.toBeNull();
  });
});

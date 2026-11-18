import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, PrismaClient, RegistrationPaymentStatus, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import * as organizationService from '../src/modules/organizations/organizations.service.js';
import { createOrganizationRegistrationLimiter, createPublicBrandLimiter, publicBrandRouter } from '../src/modules/organizations/organizations.routes.js';

const prisma = new PrismaClient();
const password = 'TestPass!1234';
const prefix = `phase1a-${Date.now()}`;
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];
let previousPlatformOwnerId: string | null = null;

async function makeOrganization(name: string, code: string) {
  const organization = await prisma.organization.create({
    data: {
      name,
      code,
      headName: `${name} Head`,
      contactNumber: '+15555550100',
      email: `${prefix}-${code}@example.test`,
      address: '10 Test Street',
      city: 'Test City',
      state: 'Test State',
      country: 'Test Country',
      status: OrganizationStatus.ACTIVE,
    },
  });
  createdOrganizationIds.push(organization.id);
  return organization;
}

async function makeUser(
  organizationId: string | null,
  role: Role,
  suffix: string,
  status = AccountStatus.APPROVED,
  identifier?: string,
) {
  const email = `${prefix}-${suffix}@example.test`;
  const user = await prisma.user.create({
    data: {
      organizationId,
      email,
      name: `${suffix} Test`,
      phone: '+15555550123',
      role,
      status,
      rejectionReason: status === AccountStatus.REJECTED ? 'Review the submitted information.' : null,
      passwordHash: await bcrypt.hash(password, 4),
      ...(role === Role.STUDENT && organizationId ? {
        studentProfile: {
          create: {
            organizationId,
            studentId: identifier ?? `${prefix}-${suffix}`,
            status: status as StudentStatus,
            rejectionReason: status === AccountStatus.REJECTED ? 'Review the submitted information.' : null,
          },
        },
      } : {}),
      ...(role === Role.TUTOR && organizationId ? {
        tutorProfile: {
          create: { organizationId, tutorId: identifier ?? `${prefix}-${suffix}` },
        },
      } : {}),
      ...(role === Role.TUTOR && organizationId ? {
        accountRegistration: {
          create: {
            organizationId,
            status: status as StudentStatus,
            rejectionReason: status === AccountStatus.REJECTED ? 'Review the submitted information.' : null,
          },
        },
      } : {}),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function registrationDetails(organizationCode: string, suffix: string) {
  const organization = await prisma.organization.findFirstOrThrow({ where: { code: organizationCode }, select: { id: true } });
  let course = await prisma.course.findFirst({
    where: { organizationId: organization.id, status: 'PUBLISHED' },
    select: { id: true },
  });
  if (!course) {
    let creator = await prisma.user.findFirst({
      where: { organizationId: organization.id, role: Role.ORG_ADMIN },
      select: { id: true },
    });
    if (!creator) {
      const newCreator = await makeUser(organization.id, Role.ORG_ADMIN, `${suffix}-course-admin`);
      creator = { id: newCreator.id };
    }
    course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: `REG-${Date.now()}`,
        title: `${suffix} Registration Course`,
        category: 'Registration',
        plannedHours: 10,
        registrationMonthlyFee: 250,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
        createdById: creator.id,
      },
      select: { id: true },
    });
  } else {
    await prisma.course.update({ where: { id: course.id }, data: { registrationMonthlyFee: 250 } });
  }
  return {
    name: `${suffix} Applicant`,
    email: `${prefix}-${suffix}@example.test`,
    phone: '9876543210',
    password,
    fatherName: 'Sample Father',
    motherName: 'Sample Mother',
    interestedCourseId: course.id,
    termsAccepted: true,
  };
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const value = response.headers['set-cookie'];
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map((item) => item.split(';')[0]).join('; ');
}

function studentLogin(organizationCode: string, studentId: string) {
  return request(app).post('/api/auth/students/login').send({ organizationCode, studentId, password });
}

function tutorLogin(organizationCode: string, tutorId: string) {
  return request(app).post('/api/auth/tutors/login').send({ organizationCode, identifier: tutorId, password });
}

function orgAdminLogin(organizationCode: string, email: string) {
  return request(app).post('/api/auth/org-admin/login').send({ organizationCode, email, password });
}

async function registerStudent(organizationCode: string, studentId: string, suffix: string) {
  const response = await request(app).post('/api/auth/students/register').send({
    organizationCode,
    studentId,
    ...await registrationDetails(organizationCode, suffix),
  });
  if (response.body.data?.user?.id) createdUserIds.push(response.body.data.user.id as string);
  return response;
}

async function confirmOfflineRegistrationPayment(organizationId: string, studentUserId: string, cookie: string) {
  const payment = await prisma.registrationPayment.findFirstOrThrow({
    where: { organizationId, studentId: studentUserId },
    select: { id: true },
  });
  return request(app)
    .put(`/api/payments/registration/${payment.id}/confirm`)
    .set('Cookie', cookie);
}

async function registerTutor(organizationCode: string, tutorId: string, suffix: string) {
  const response = await request(app).post('/api/auth/tutors/register').send({
    organizationCode,
    tutorId,
    ...await registrationDetails(organizationCode, suffix),
  });
  if (response.body.data?.user?.id) createdUserIds.push(response.body.data.user.id as string);
  return response;
}

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  if (previousPlatformOwnerId) {
    await prisma.organization.updateMany({ where: { isPlatformOwner: true }, data: { isPlatformOwner: false } });
    await prisma.organization.update({
      where: { id: previousPlatformOwnerId },
      data: { isPlatformOwner: true },
    });
  }
  const organizationIds = [...new Set(createdOrganizationIds)];
  const userIds = [...new Set(createdUserIds)];
  if (organizationIds.length) {
    await prisma.registrationPayment.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.note.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.expertSession.deleteMany({ where: { organizationId: { in: organizationIds } } });
  }
  if (organizationIds.length || userIds.length) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
          ...(userIds.length ? [{ actorId: { in: userIds } }] : []),
        ],
      },
    });
  }
  if (userIds.length || organizationIds.length) {
    await prisma.user.deleteMany({
      where: {
        OR: [
          ...(userIds.length ? [{ id: { in: userIds } }] : []),
          ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
        ],
      },
    });
  }
  if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('multi-organization authentication and approvals', () => {
  it('activates public organization registrations and supports approval only when configured', async () => {
    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'super-admin');
    const adminLogin = await request(app).post('/api/auth/super-admin/login').send({ email: superAdmin.email, password });
    expect(adminLogin.status).toBe(200);
    const adminCookie = cookieHeader(adminLogin);

    const registrationInput = {
      organizationName: `${prefix} Academy`,
      organizationHeadName: 'Organization Head',
      contactNumber: '+15555550125',
      email: `${prefix}-org@example.test`,
      address: '12 Learning Road',
      city: 'Learning City',
      state: 'Learning State',
      country: 'Learning Country',
      registrationNumber: 'REG-1',
      website: 'https://example.test',
      password,
    };
    const registration = await request(app).post('/api/organizations/register').send(registrationInput);
    expect(registration.status).toBe(201);
    const registeredOrganization = registration.body.data.organization as { id: string; code: string; status: OrganizationStatus; adminUserId: string };
    const organizationId = registeredOrganization.id;
    createdOrganizationIds.push(organizationId);
    createdUserIds.push(registeredOrganization.adminUserId);
    expect(registeredOrganization.status).toBe(OrganizationStatus.ACTIVE);
    expect(registeredOrganization.code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'ORGANIZATION_REGISTERED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'ORG_ADMIN_ACCOUNT_CREATED' } })).toBe(1);

    const organizationCode = registeredOrganization.code;
    const orgAdmin = await orgAdminLogin(organizationCode, `${prefix}-org@example.test`);
    expect(orgAdmin.status).toBe(200);
    expect(orgAdmin.body.data.user.role).toBe(Role.ORG_ADMIN);
    const currentUser = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(orgAdmin));
    expect(currentUser.body.data.user.organization).toEqual({
      name: registrationInput.organizationName,
      code: organizationCode,
      isPlatformOwner: false,
    });

    const monitored = await request(app).get('/api/super-admin/organizations').set('Cookie', adminCookie);
    expect(monitored.status).toBe(200);
    const monitoredOrg = monitored.body.data.organizations.find((item: { id: string }) => item.id === organizationId);
    expect(monitoredOrg.counts).toEqual({ students: 0, tutors: 0 });

    const oldAdminSessionCookie = cookieHeader(orgAdmin);
    const suspension = await request(app).post(`/api/super-admin/organizations/${organizationId}/suspend`).set('Cookie', adminCookie);
    expect(suspension.status).toBe(200);
    expect(suspension.body.data.organization.status).toBe(OrganizationStatus.SUSPENDED);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'ORGANIZATION_SUSPENDED' } })).toBe(1);
    expect((await orgAdminLogin(organizationCode, `${prefix}-org@example.test`)).status).toBe(403);
    expect((await request(app).get('/api/auth/me').set('Cookie', oldAdminSessionCookie)).status).toBe(403);
    const reactivation = await request(app).post(`/api/super-admin/organizations/${organizationId}/reactivate`).set('Cookie', adminCookie);
    expect(reactivation.status).toBe(200);
    expect(reactivation.body.data.organization.status).toBe(OrganizationStatus.ACTIVE);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'ORGANIZATION_REACTIVATED' } })).toBe(1);
    expect((await orgAdminLogin(organizationCode, `${prefix}-org@example.test`)).status).toBe(200);

    const pendingInput = { ...registrationInput, email: `${prefix}-pending@example.test` };
    const previousApprovalSetting = env.REQUIRE_ORG_APPROVAL;
    const pendingRegistration = await (async () => {
      env.REQUIRE_ORG_APPROVAL = true;
      try {
        return await request(app).post('/api/organizations/register').send(pendingInput);
      } finally {
        env.REQUIRE_ORG_APPROVAL = previousApprovalSetting;
      }
    })();
    expect(pendingRegistration.status).toBe(201);
    const pendingOrganization = pendingRegistration.body.data.organization as { id: string; code: string | null; status: OrganizationStatus };
    createdOrganizationIds.push(pendingOrganization.id);
    expect(pendingOrganization.status).toBe(OrganizationStatus.PENDING);
    expect(pendingOrganization.code).toBeNull();
    expect(await prisma.user.findFirst({ where: { organizationId: pendingOrganization.id, role: Role.ORG_ADMIN } })).toBeNull();
    expect((await orgAdminLogin('pending-code', pendingInput.email)).status).toBe(401);
    const pendingApproval = await request(app)
      .post(`/api/super-admin/organizations/${pendingOrganization.id}/approve`)
      .set('Cookie', adminCookie)
      .send({});
    expect(pendingApproval.status).toBe(200);
    createdUserIds.push(pendingApproval.body.data.organization.adminUserId as string);
    expect(pendingApproval.body.data.organization.status).toBe(OrganizationStatus.ACTIVE);
    expect((await orgAdminLogin(pendingApproval.body.data.organization.code, pendingInput.email)).status).toBe(200);

    const duplicate = await request(app).post('/api/organizations/register').send(registrationInput);
    expect(duplicate.status).toBe(409);
  });

  it('rate limits organization registrations by IP', async () => {
    const limiterTestApp = express();
    limiterTestApp.post('/register', createOrganizationRegistrationLimiter(2), (_req, res) => res.status(201).end());
    expect((await request(limiterTestApp).post('/register')).status).toBe(201);
    expect((await request(limiterTestApp).post('/register')).status).toBe(201);
    expect((await request(limiterTestApp).post('/register')).status).toBe(429);
  });

  it('returns minimal public brand variants with identical unknown-code response shapes', async () => {
    const organization = await makeOrganization(`${prefix} Public Brand`, `${prefix}-public-brand`);
    const previousSetting = env.SHOW_PARTNER_ORG_NAME;
    try {
      env.SHOW_PARTNER_ORG_NAME = false;
      const partner = await request(app).get(`/api/public/brand?orgCode=${organization.code}`);
      const unknown = await request(app).get(`/api/public/brand?orgCode=${prefix}-unknown`);
      expect(partner.status).toBe(200);
      expect(partner.body.data).toEqual({ variant: 'PARTNER' });
      expect(unknown.body.data).toEqual({ variant: 'OWNER' });
      expect(Object.keys(partner.body.data)).toEqual(Object.keys(unknown.body.data));

      env.SHOW_PARTNER_ORG_NAME = true;
      const namedPartner = await request(app).get(`/api/public/brand?orgCode=${organization.code}`);
      const namedUnknown = await request(app).get(`/api/public/brand?orgCode=${prefix}-unknown`);
      expect(namedPartner.body.data).toEqual({ variant: 'PARTNER', organizationName: organization.name });
      expect(namedUnknown.body.data).toEqual({ variant: 'OWNER', organizationName: null });
      expect(Object.keys(namedPartner.body.data)).toEqual(Object.keys(namedUnknown.body.data));
      expect(namedPartner.body.data).not.toHaveProperty('code');
      expect(namedPartner.body.data).not.toHaveProperty('email');
    } finally {
      env.SHOW_PARTNER_ORG_NAME = previousSetting;
    }

    const limiterTestApp = express();
    limiterTestApp.use('/api/public', createPublicBrandLimiter(2), publicBrandRouter);
    expect((await request(limiterTestApp).get('/api/public/brand')).status).toBe(200);
    expect((await request(limiterTestApp).get('/api/public/brand')).status).toBe(200);
    expect((await request(limiterTestApp).get('/api/public/brand')).status).toBe(429);
  });

  it('allows only one platform owner and audits changes made by Super Admin', async () => {
    const previousOwner = await prisma.organization.findFirst({
      where: { isPlatformOwner: true },
      select: { id: true },
    });
    previousPlatformOwnerId = previousOwner?.id ?? null;
    const firstOwner = await makeOrganization(`${prefix} First Platform Owner`, `${prefix}-owner-first`);
    const secondOwner = await makeOrganization(`${prefix} Second Platform Owner`, `${prefix}-owner-second`);
    const tenantAdmin = await makeUser(firstOwner.id, Role.ORG_ADMIN, 'platform-owner-tenant-admin');
    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'platform-owner-super-admin');
    const superAdminLogin = await request(app).post('/api/auth/super-admin/login')
      .send({ email: superAdmin.email, password });
    const tenantAdminLogin = await orgAdminLogin(firstOwner.code!, tenantAdmin.email);

    const denied = await request(app)
      .post(`/api/super-admin/organizations/${secondOwner.id}/platform-owner`)
      .set('Cookie', cookieHeader(tenantAdminLogin))
      .send({});
    expect(denied.status).toBe(403);

    const firstChange = await request(app)
      .post(`/api/super-admin/organizations/${firstOwner.id}/platform-owner`)
      .set('Cookie', cookieHeader(superAdminLogin))
      .send({});
    expect(firstChange.status).toBe(200);
    expect(firstChange.body.data.organization.isPlatformOwner).toBe(true);
    expect(await prisma.auditLog.count({
      where: { organizationId: firstOwner.id, action: 'PLATFORM_OWNER_SET', actorId: superAdmin.id },
    })).toBe(1);

    const secondChange = await request(app)
      .post(`/api/super-admin/organizations/${secondOwner.id}/platform-owner`)
      .set('Cookie', cookieHeader(superAdminLogin))
      .send({});
    expect(secondChange.status).toBe(200);
    expect(await prisma.organization.count({ where: { isPlatformOwner: true } })).toBe(1);
    expect(await prisma.organization.findUnique({ where: { id: firstOwner.id }, select: { isPlatformOwner: true } }))
      .toEqual({ isPlatformOwner: false });
    expect(await prisma.organization.findUnique({ where: { id: secondOwner.id }, select: { isPlatformOwner: true } }))
      .toEqual({ isPlatformOwner: true });
    expect(await prisma.auditLog.count({
      where: { organizationId: secondOwner.id, action: 'PLATFORM_OWNER_SET', actorId: superAdmin.id },
    })).toBe(1);
  });

  it('keeps Super Admin login isolated from tenant roles', async () => {
    const organization = await makeOrganization(`${prefix} Role Isolation`, `${prefix}-role-isolation`);
    const orgAdmin = await makeUser(organization.id, Role.ORG_ADMIN, 'role-isolation-admin');
    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'role-isolation-super');
    expect((await request(app).post('/api/auth/super-admin/login').send({ email: orgAdmin.email, password })).status).toBe(401);
    expect((await request(app).post('/api/auth/org-admin/login').send({ organizationCode: organization.code, email: superAdmin.email, password })).status).toBe(401);
    expect((await request(app).post('/api/auth/super-admin/login').send({ email: superAdmin.email, password })).status).toBe(200);
  });

  it('allows Tutors to sign in through the Tutor portal and retires Instructor auth endpoints', async () => {
    const organization = await makeOrganization(`${prefix} Tutor Portal`, `${prefix}-tutor-portal`);
    const tutor = await makeUser(organization.id, Role.TUTOR, 'tutor-portal-tutor', AccountStatus.APPROVED, 'TUT-PORTAL-EMAIL');

    const tutorLogin = await request(app).post('/api/auth/tutors/login').send({
      organizationCode: organization.code,
      identifier: tutor.email,
      password,
    });

    expect(tutorLogin.status, JSON.stringify(tutorLogin.body)).toBe(200);
    expect(tutorLogin.body.data.user.role).toBe(Role.TUTOR);
    expect((await request(app).post('/api/auth/instructors/login')).status).toBe(410);
    expect((await request(app).post('/api/auth/instructors/register')).status).toBe(410);
  });

  it('rejects organization approval attempts by tenant administrators', async () => {
    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'unauthorized-super-admin');
    const superAdminLogin = await request(app).post('/api/auth/super-admin/login').send({ email: superAdmin.email, password });
    const tenant = await makeOrganization(`${prefix} Non-platform`, `${prefix}-non-platform`);
    const tenantAdmin = await makeUser(tenant.id, Role.ORG_ADMIN, 'non-platform-admin');
    const tenantAdminLogin = await orgAdminLogin(tenant.code!, tenantAdmin.email);
    const registration = await organizationService.register({
      organizationName: `${prefix} Pending Org`,
      organizationHeadName: 'Pending Org Head',
      contactNumber: '+15555550125',
      email: `${prefix}-pending-org-approval@example.test`,
      address: '12 Learning Road',
      city: 'Learning City',
      state: 'Learning State',
      country: 'Learning Country',
      password,
    }, true);
    createdOrganizationIds.push(registration.id);
    const adminApprovalAttempt = await request(app)
      .post(`/api/super-admin/organizations/${registration.id}/approve`)
      .set('Cookie', cookieHeader(tenantAdminLogin))
      .send({});
    expect(adminApprovalAttempt.status).toBe(403);
    const approval = await request(app)
      .post(`/api/super-admin/organizations/${registration.id}/approve`)
      .set('Cookie', cookieHeader(superAdminLogin))
      .send({});
    expect(approval.status).toBe(200);
    createdUserIds.push(approval.body.data.organization.adminUserId as string);
  });

  it('keeps legacy organization rejection available only for registrations awaiting approval', async () => {
    const admin = await makeUser(null, Role.SUPER_ADMIN, 'reject-pending-super-admin');
    const adminLogin = await request(app).post('/api/auth/super-admin/login').send({ email: admin.email, password });
    const pending = await organizationService.register({
      organizationName: `${prefix} Rejected Academy`,
      organizationHeadName: 'Rejected Head',
      contactNumber: '+15555550126',
      email: `${prefix}-rejected-org@example.test`,
      address: '14 Learning Road',
      city: 'Learning City',
      state: 'Learning State',
      country: 'Learning Country',
      password,
    }, true);
    createdOrganizationIds.push(pending.id);
    const rejection = await request(app)
      .post(`/api/super-admin/organizations/${pending.id}/reject`)
      .set('Cookie', cookieHeader(adminLogin))
      .send({ reason: 'Registration documents need review.' });
    expect(rejection.status).toBe(200);
    expect(rejection.body.data.organization.status).toBe(OrganizationStatus.REJECTED);
    expect(await prisma.user.findFirst({ where: { organizationId: pending.id, role: Role.ORG_ADMIN } })).toBeNull();
  });

  it('allows the same Student ID and Tutor ID in separate organizations, but rejects duplicates within one', async () => {
    const first = await makeOrganization(`${prefix} First`, `${prefix}-first`);
    const second = await makeOrganization(`${prefix} Second`, `${prefix}-second`);

    const firstStudent = await registerStudent(first.code!, 'SHARED-100', 'first-student');
    const secondStudent = await registerStudent(second.code!, 'SHARED-100', 'second-student');
    const duplicateStudent = await registerStudent(first.code!, 'SHARED-100', 'duplicate-student');
    expect(firstStudent.status).toBe(201);
    expect(secondStudent.status).toBe(201);
    expect(duplicateStudent.status).toBe(409);

    const tutorA = await registerTutor(first.code!, 'TUT-SHARED-1', 'tutor-a');
    const tutorB = await registerTutor(second.code!, 'TUT-SHARED-1', 'tutor-b');
    const duplicateTutor = await registerTutor(first.code!, 'TUT-SHARED-1', 'tutor-duplicate');
    for (const response of [tutorA, tutorB]) {
      expect(response.status).toBe(201);
      createdUserIds.push(response.body.data.user.id as string);
    }
    expect(duplicateTutor.status).toBe(409);
  });

  it('scopes registration courses and encrypts identifiers without exposing them in responses', async () => {
    const first = await makeOrganization(`${prefix} Registration A`, `${prefix}-registration-a`);
    const second = await makeOrganization(`${prefix} Registration B`, `${prefix}-registration-b`);
    const firstFields = await registrationDetails(first.code!, 'registration-student');
    const secondFields = await registrationDetails(second.code!, 'registration-other');
    const options = await request(app).get(`/api/auth/registration-options?organizationCode=${first.code}`);
    expect(options.status).toBe(200);
    expect(options.body.data.courses.map((course: { id: string }) => course.id)).toContain(firstFields.interestedCourseId);
    expect(options.body.data.courses.map((course: { id: string }) => course.id)).not.toContain(secondFields.interestedCourseId);
    const termsNotAccepted = await request(app).post('/api/auth/students/register').send({
      organizationCode: first.code,
      studentId: `${prefix}-terms-not-accepted`,
      ...firstFields,
      termsAccepted: false,
    });
    expect(termsNotAccepted.status).toBe(400);

    const wrongTenantCourse = await request(app).post('/api/auth/students/register').send({
      organizationCode: first.code,
      studentId: `${prefix}-wrong-course`,
      ...firstFields,
      interestedCourseId: secondFields.interestedCourseId,
    });
    expect(wrongTenantCourse.status).toBe(400);

    const identityValues = { aadhaarNumber: '200000000009', apaarId: '987654321098', piiConsent: true };
    const studentRegistration = await request(app).post('/api/auth/students/register').send({
      organizationCode: first.code,
      studentId: `${prefix}-private-student`,
      ...firstFields,
      ...identityValues,
    });
    expect(studentRegistration.status).toBe(201);
    expect(JSON.stringify(studentRegistration.body)).not.toContain(identityValues.aadhaarNumber);
    expect(JSON.stringify(studentRegistration.body)).not.toContain(identityValues.apaarId);
    const studentId = studentRegistration.body.data.user.id as string;
    createdUserIds.push(studentId);
    const studentProfile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: studentId },
      select: {
        aadhaarEncrypted: true, aadhaarLast4: true, apaarIdEncrypted: true, apaarIdLast4: true,
        piiConsentAt: true, termsAcceptedAt: true, interestedCourse: true,
      },
    });
    expect(studentProfile).toMatchObject({ aadhaarLast4: '0009', apaarIdLast4: '1098' });
    expect(studentProfile.interestedCourse).toContain('Registration Course');
    expect(studentProfile.aadhaarEncrypted).not.toContain(identityValues.aadhaarNumber);
    expect(studentProfile.apaarIdEncrypted).not.toContain(identityValues.apaarId);
    expect(studentProfile.piiConsentAt).not.toBeNull();
    expect(studentProfile.termsAcceptedAt).not.toBeNull();
    const accountAudit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: first.id, targetId: studentId, action: 'ACCOUNT_CREATED' },
      select: { metadata: true },
    });
    expect(JSON.stringify(accountAudit.metadata)).not.toContain(identityValues.aadhaarNumber);
    expect(JSON.stringify(accountAudit.metadata)).not.toContain(identityValues.apaarId);
    const duplicateEmail = await request(app).post('/api/auth/students/register').send({
      organizationCode: first.code,
      studentId: `${prefix}-duplicate-email`,
      ...firstFields,
    });
    expect(duplicateEmail.status).toBe(409);

    const tutorRegistration = await request(app).post('/api/auth/tutors/register').send({
      organizationCode: first.code,
      tutorId: `TUT-${Date.now()}`,
      ...await registrationDetails(first.code!, 'registration-tutor'),
      ...identityValues,
    });
    expect(tutorRegistration.status).toBe(201);
    expect(JSON.stringify(tutorRegistration.body)).not.toContain(identityValues.aadhaarNumber);
    const tutorId = tutorRegistration.body.data.user.id as string;
    createdUserIds.push(tutorId);
    const admin = await makeUser(first.id, Role.ORG_ADMIN, 'registration-review-admin');
    const adminCookie = cookieHeader(await orgAdminLogin(first.code!, admin.email));
    const tutorList = await request(app).get('/api/org-admin/tutors/registrations?status=PENDING').set('Cookie', adminCookie);
    const visibleTutor = tutorList.body.data.registrations.find((registration: { user: { id: string } }) => registration.user.id === tutorId);
    expect(visibleTutor).toMatchObject({ aadhaarNumber: 'XXXX XXXX 0009', apaarId: 'XXXX XXXX 1098' });
    expect(JSON.stringify(visibleTutor)).not.toContain(identityValues.aadhaarNumber);
    const tutorIdentifier = 'TUT-REGISTRATION-REVIEW';
    await makeUser(first.id, Role.TUTOR, 'registration-review-tutor', AccountStatus.APPROVED, tutorIdentifier);
    const tutorCookie = cookieHeader(await tutorLogin(first.code!, tutorIdentifier));
    const registrationPaymentConfirmation = await confirmOfflineRegistrationPayment(first.id, studentId, adminCookie);
    expect(registrationPaymentConfirmation.status).toBe(200);
    expect(registrationPaymentConfirmation.body.data.accountStatus).toBe(AccountStatus.APPROVED);
    const studentList = await request(app).get('/api/tutor/registrations?status=APPROVED').set('Cookie', tutorCookie);
    const visibleStudent = studentList.body.data.registrations.find((registration: { user: { id: string } }) => registration.user.id === studentId);
    expect(visibleStudent).toBeDefined();
    expect(visibleStudent).not.toHaveProperty('aadhaarNumber');
    expect(visibleStudent).not.toHaveProperty('apaarId');
    expect(visibleStudent).not.toHaveProperty('fatherName');
    expect(visibleStudent).not.toHaveProperty('motherName');
  });

  it('approves students immediately after offline payment and supports tenant-scoped refunds', async () => {
    const first = await makeOrganization(`${prefix} Payment A`, `${prefix}-payment-a`);
    const second = await makeOrganization(`${prefix} Payment B`, `${prefix}-payment-b`);
    const adminA = await makeUser(first.id, Role.ORG_ADMIN, 'payment-admin-a');
    const adminB = await makeUser(second.id, Role.ORG_ADMIN, 'payment-admin-b');
    const tutorIdentifier = `TUT-PAYMENT-${Date.now()}`;
    await makeUser(first.id, Role.TUTOR, 'payment-tutor', AccountStatus.APPROVED, tutorIdentifier);
    const adminCookie = cookieHeader(await orgAdminLogin(first.code!, adminA.email));
    const otherAdminCookie = cookieHeader(await orgAdminLogin(second.code!, adminB.email));
    const tutorCookie = cookieHeader(await tutorLogin(first.code!, tutorIdentifier));

    const registration = await registerStudent(first.code!, `${prefix}-payment-student`, 'payment-student');
    expect(registration.status).toBe(201);
    const student = registration.body.data.user as { id: string; status: AccountStatus; studentProfile: { studentId: string } };
    const statusToken = registration.body.data.registrationAccessToken as string;
    expect(student.status).toBe(AccountStatus.PENDING_PAYMENT);
    expect((await studentLogin(first.code!, student.studentProfile.studentId)).body.error.message).toContain('awaiting offline payment confirmation');
    const pendingStatus = await request(app).post('/api/auth/students/registration-status').send({ token: statusToken });
    expect(pendingStatus.status).toBe(200);
    expect(pendingStatus.body.data).toMatchObject({
      paymentStatus: 'PENDING',
      accountStatus: 'PENDING_PAYMENT',
      course: { title: expect.stringContaining('Registration Course') },
      amount: 250,
    });
    expect(JSON.stringify(pendingStatus.body)).not.toContain('statusTokenHash');

    const payment = await prisma.registrationPayment.findFirstOrThrow({
      where: { organizationId: first.id, studentId: student.id },
      select: { id: true },
    });
    const pendingPayments = await request(app).get('/api/payments/registration?status=PENDING').set('Cookie', adminCookie);
    expect(pendingPayments.status).toBe(200);
    expect(pendingPayments.body.data.payments.some((item: { id: string }) => item.id === payment.id)).toBe(true);
    expect((await request(app).get('/api/payments/registration').set('Cookie', tutorCookie)).status).toBe(403);
    expect((await request(app).put(`/api/payments/registration/${payment.id}/confirm`).set('Cookie', otherAdminCookie)).status).toBe(404);
    expect((await request(app).post(`/api/tutor/registrations/${student.studentProfile.studentId}/approve`).set('Cookie', tutorCookie).send({})).status).toBe(409);

    const confirmation = await request(app).put(`/api/payments/registration/${payment.id}/confirm`).set('Cookie', adminCookie);
    expect(confirmation.status).toBe(200);
    expect(confirmation.body.data.accountStatus).toBe(AccountStatus.APPROVED);
    expect(await prisma.auditLog.count({ where: { organizationId: first.id, actorId: adminA.id, action: 'STUDENT_REGISTRATION_PAYMENT_CONFIRMED' } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { organizationId: first.id, actorId: adminA.id, action: 'STUDENT_APPROVED', targetId: (await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } })).id },
    })).toBe(1);
    expect((await studentLogin(first.code!, student.studentProfile.studentId)).status).toBe(200);
    expect((await request(app)
      .post(`/api/tutor/registrations/${encodeURIComponent(student.studentProfile.studentId)}/approve`)
      .set('Cookie', tutorCookie)
      .send({})).status).toBe(409);
    const approvedStatus = await request(app).post('/api/auth/students/registration-status').send({ token: statusToken });
    expect(approvedStatus.body.data).toMatchObject({ paymentStatus: 'PAID', accountStatus: AccountStatus.APPROVED });

    const rejectedRegistration = await registerStudent(first.code!, `${prefix}-payment-rejected`, 'payment-rejected');
    const rejectedUserId = rejectedRegistration.body.data.user.id as string;
    const rejectedPayment = await prisma.registrationPayment.findFirstOrThrow({
      where: { organizationId: first.id, studentId: rejectedUserId },
      select: { id: true },
    });
    await prisma.registrationPayment.update({
      where: { id: rejectedPayment.id },
      data: { status: RegistrationPaymentStatus.PAID, paidAt: new Date() },
    });
    await prisma.user.update({
      where: { id: rejectedUserId },
      data: { status: AccountStatus.REJECTED, rejectionReason: 'Application was rejected after payment.' },
    });
    await prisma.studentProfile.update({
      where: { userId: rejectedUserId },
      data: { status: StudentStatus.REJECTED, rejectionReason: 'Application was rejected after payment.' },
    });
    const refund = await request(app)
      .put(`/api/payments/registration/${rejectedPayment.id}/refund`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Offline refund recorded to applicant.' });
    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe('REFUNDED');
    expect(await prisma.auditLog.count({ where: { organizationId: first.id, actorId: adminA.id, action: 'STUDENT_REGISTRATION_PAYMENT_REFUNDED' } })).toBe(1);
  });

  it('enforces pending, rejected, and suspended login states and revokes older student sessions', async () => {
    const organization = await makeOrganization(`${prefix} Status`, `${prefix}-status`);
    const pending = await makeUser(organization.id, Role.STUDENT, 'pending', AccountStatus.PENDING, 'PENDING-ID');
    const rejected = await makeUser(organization.id, Role.STUDENT, 'rejected', AccountStatus.REJECTED, 'REJECTED-ID');
    const suspended = await makeUser(organization.id, Role.STUDENT, 'suspended', AccountStatus.SUSPENDED, 'SUSPENDED-ID');
    await makeUser(organization.id, Role.TUTOR, 'rejected-tutor', AccountStatus.REJECTED, 'REJECTED-TUTOR');
    await makeUser(organization.id, Role.TUTOR, 'suspended-tutor', AccountStatus.SUSPENDED);
    const pendingLogin = await studentLogin(organization.code!, 'PENDING-ID');
    expect(pendingLogin.status).toBe(403);
    expect(pendingLogin.body.error.message).toContain('pending Tutor approval');
    const rejectedLogin = await studentLogin(organization.code!, 'REJECTED-ID');
    expect(rejectedLogin.status).toBe(403);
    expect(rejectedLogin.body.error.message).toContain('Review the submitted information.');
    const suspendedLogin = await studentLogin(organization.code!, 'SUSPENDED-ID');
    expect(suspendedLogin.status).toBe(403);
    expect(suspendedLogin.body.error.message).toContain('suspended');
    const rejectedTutorLogin = await tutorLogin(organization.code!, 'REJECTED-TUTOR');
    expect(rejectedTutorLogin.status).toBe(403);
    expect(rejectedTutorLogin.body.error.message).toContain('Review the submitted information.');
    const suspendedTutorLogin = await tutorLogin(organization.code!, `${prefix}-suspended-tutor`);
    expect(suspendedTutorLogin.status).toBe(403);
    expect(suspendedTutorLogin.body.error.message).toContain('suspended');
    expect([pending.id, rejected.id, suspended.id]).toHaveLength(3);

    const active = await makeUser(organization.id, Role.STUDENT, 'single-session', AccountStatus.APPROVED, 'SINGLE-ID');
    const firstLogin = await studentLogin(organization.code!, 'SINGLE-ID');
    const oldCookie = cookieHeader(firstLogin);
    expect(firstLogin.status).toBe(200);
    const secondLogin = await studentLogin(organization.code!, 'SINGLE-ID');
    expect(secondLogin.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: active.id, revokedAt: null } })).toBe(1);
  });

  it('returns a safe current-user profile for every role and rejects invalid, expired, and revoked sessions', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'accessToken=invalid')).status).toBe(401);

    const organization = await makeOrganization(`${prefix} Me`, `${prefix}-me`);
    const users = [
      { user: await makeUser(null, Role.SUPER_ADMIN, 'me-super-admin'), role: Role.SUPER_ADMIN },
      { user: await makeUser(organization.id, Role.ORG_ADMIN, 'me-org-admin'), role: Role.ORG_ADMIN },
      { user: await makeUser(organization.id, Role.TUTOR, 'me-tutor', AccountStatus.APPROVED, 'ME-TUTOR'), role: Role.TUTOR },
      { user: await makeUser(organization.id, Role.STUDENT, 'me-student', AccountStatus.APPROVED, 'ME-STUDENT'), role: Role.STUDENT },
    ];

    for (const { user, role } of users) {
      const login = role === Role.SUPER_ADMIN
        ? await request(app).post('/api/auth/super-admin/login').send({ email: user.email, password })
        : role === Role.ORG_ADMIN
          ? await orgAdminLogin(organization.code!, user.email)
          : role === Role.TUTOR
              ? await tutorLogin(organization.code!, 'ME-TUTOR')
              : await studentLogin(organization.code!, 'ME-STUDENT');
      expect(login.status).toBe(200);

      const response = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(login));
      expect(response.status).toBe(200);
      expect(response.body.data.user).toMatchObject({
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        role,
        status: AccountStatus.APPROVED,
        mustChangePassword: false,
        organization: role === Role.SUPER_ADMIN ? null : {
          name: organization.name,
          code: organization.code,
          isPlatformOwner: false,
        },
      });
      if (role === Role.STUDENT) expect(response.body.data.user.studentId).toBe('ME-STUDENT');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(response.body.data.user)).not.toMatch(/accessToken|refreshToken|passwordHash|token/i);
    }

    const expiredStudent = await makeUser(organization.id, Role.STUDENT, 'expired-me', AccountStatus.APPROVED, 'EXPIRED-ME');
    const expiredLogin = await studentLogin(organization.code!, 'EXPIRED-ME');
    const expiredSession = await prisma.session.findFirstOrThrow({ where: { userId: expiredStudent.id } });
    await prisma.session.update({ where: { id: expiredSession.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookieHeader(expiredLogin))).status).toBe(401);

    const revokedStudent = await makeUser(organization.id, Role.STUDENT, 'revoked-me', AccountStatus.APPROVED, 'REVOKED-ME');
    const revokedLogin = await studentLogin(organization.code!, 'REVOKED-ME');
    const revokedSession = await prisma.session.findFirstOrThrow({ where: { userId: revokedStudent.id } });
    await prisma.session.update({ where: { id: revokedSession.id }, data: { revokedAt: new Date() } });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookieHeader(revokedLogin))).status).toBe(401);
  });

  it('applies approval permissions and isolates student records by organization', async () => {
    const first = await makeOrganization(`${prefix} Tenant A`, `${prefix}-tenant-a`);
    const second = await makeOrganization(`${prefix} Tenant B`, `${prefix}-tenant-b`);
    await makeUser(first.id, Role.TUTOR, 'legacy-tutor', AccountStatus.APPROVED, 'STF-1001');
    const adminA = await makeUser(first.id, Role.ORG_ADMIN, 'admin-a');
    const adminB = await makeUser(second.id, Role.ORG_ADMIN, 'admin-b');
    const tutorB = await makeUser(second.id, Role.TUTOR, 'tutor-b');
    const studentA = await makeUser(first.id, Role.STUDENT, 'student-a', AccountStatus.APPROVED, 'DUPLICATE-ID');
    const studentB = await makeUser(second.id, Role.STUDENT, 'student-b', AccountStatus.APPROVED, 'DUPLICATE-ID');
    const pendingStudentB = await makeUser(second.id, Role.STUDENT, 'pending-student-b', AccountStatus.PENDING, 'B-ONLY-PENDING');

    const legacyTutorLogin = await tutorLogin(first.code!, 'STF-1001');
    expect(legacyTutorLogin.status, JSON.stringify(legacyTutorLogin.body)).toBe(200);

    const pendingTutorIdentifier = `TUT-PENDING-${Date.now()}`;
    const pendingTutorRegistration = await registerTutor(first.code!, pendingTutorIdentifier, 'pending-tutor-a');
    expect(pendingTutorRegistration.status).toBe(201);
    const pendingTutorId = pendingTutorRegistration.body.data.user.id as string;
    createdUserIds.push(pendingTutorId);
    const pendingStudentRegistration = await registerStudent(first.code!, `${prefix}-pending-student-a`, 'pending-student-a');
    expect(pendingStudentRegistration.status).toBe(201);
    const pendingStudentId = pendingStudentRegistration.body.data.user.studentProfile.studentId as string;
    await makeUser(first.id, Role.STUDENT, 'admin-student', AccountStatus.PENDING, 'ADMIN-STUDENT');

    const pendingTutorLogin = await tutorLogin(first.code!, pendingTutorIdentifier);
    expect(pendingTutorLogin.status).toBe(403);
    expect(pendingTutorLogin.body.error.message).toContain('pending organization admin approval');
    const orgAdmin = await orgAdminLogin(first.code!, adminA.email);
    expect(orgAdmin.status).toBe(200);
    const orgAdminB = await orgAdminLogin(second.code!, adminB.email);
    expect(orgAdminB.status).toBe(200);
    const crossTenantTutorApproval = await request(app)
      .post(`/api/org-admin/tutors/${pendingTutorId}/approve`)
      .set('Cookie', cookieHeader(orgAdminB))
      .send({});
    expect(crossTenantTutorApproval.status).toBe(404);
    const tutorApproval = await request(app)
      .post(`/api/org-admin/tutors/${pendingTutorId}/approve`)
      .set('Cookie', cookieHeader(orgAdmin))
      .send({});
    expect(tutorApproval.status).toBe(200);
    const tutorLoginResponse = await tutorLogin(first.code!, pendingTutorIdentifier);
    expect(tutorLoginResponse.status).toBe(200);

    const adminStudentApproval = await request(app)
      .post(`/api/org-admin/students/registrations/${encodeURIComponent('ADMIN-STUDENT')}/approve`)
      .set('Cookie', cookieHeader(orgAdmin))
      .send({});
    expect(adminStudentApproval.status).toBe(403);
    expect((await studentLogin(first.code!, 'ADMIN-STUDENT')).status).toBe(403);

    const tutorCookie = cookieHeader(tutorLoginResponse);
    const registrationPaymentConfirmation = await confirmOfflineRegistrationPayment(first.id, pendingStudentRegistration.body.data.user.id as string, cookieHeader(orgAdmin));
    expect(registrationPaymentConfirmation.status).toBe(200);
    expect(registrationPaymentConfirmation.body.data.accountStatus).toBe(AccountStatus.APPROVED);
    const tutorTutorApprovalAttempt = await request(app)
      .post(`/api/org-admin/tutors/${pendingTutorId}/approve`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(tutorTutorApprovalAttempt.status).toBe(403);
    const approveStudent = await request(app)
      .post(`/api/tutor/registrations/${encodeURIComponent(pendingStudentId)}/approve`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(approveStudent.status).toBe(409);
    expect((await studentLogin(first.code!, `${prefix}-pending-student-a`)).status).toBe(200);
    expect((await tutorLogin(first.code!, pendingTutorIdentifier)).status).toBe(200);
    const acceptedStudents = await request(app)
      .get('/api/tutor/registrations?status=APPROVED')
      .set('Cookie', tutorCookie);
    const acceptedStudent = acceptedStudents.body.data.registrations.find((registration: { studentId: string }) => registration.studentId === pendingStudentId);
    expect(acceptedStudent).toBeDefined();
    expect(acceptedStudent).not.toHaveProperty('aadhaarNumber');
    expect(acceptedStudent).not.toHaveProperty('fatherName');
    const rejectedRegistration = await registerStudent(first.code!, `${prefix}-optional-reject`, 'optional-reject');
    expect(rejectedRegistration.status).toBe(201);
    const rejectedStudentId = rejectedRegistration.body.data.user.studentProfile.studentId as string;
    const rejectedUserId = rejectedRegistration.body.data.user.id as string;
    const rejectedPaymentConfirmation = await confirmOfflineRegistrationPayment(first.id, rejectedRegistration.body.data.user.id as string, cookieHeader(orgAdmin));
    expect(rejectedPaymentConfirmation.status).toBe(200);
    expect(rejectedPaymentConfirmation.body.data.accountStatus).toBe(AccountStatus.APPROVED);
    const postPaymentRejectionAttempt = await request(app)
      .post(`/api/tutor/registrations/${encodeURIComponent(rejectedStudentId)}/reject`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(postPaymentRejectionAttempt.status).toBe(409);
    await prisma.user.update({
      where: { id: rejectedUserId },
      data: { status: AccountStatus.REJECTED, rejectionReason: null },
    });
    await prisma.studentProfile.update({
      where: { userId: rejectedUserId },
      data: { status: StudentStatus.REJECTED, rejectionReason: null },
    });
    const rejection = await request(app)
      .get('/api/payments/registration?status=PAID')
      .set('Cookie', cookieHeader(orgAdmin));
    expect(rejection.body.data.payments.some((item: { student: { id: string; status: string } }) =>
      item.student.id === rejectedUserId && item.student.status === AccountStatus.REJECTED,
    )).toBe(true);
    expect((await studentLogin(first.code!, `${prefix}-optional-reject`)).body.error.message).toBe('Your registration was rejected');

    const tutorApprovalAttempt = await request(app)
      .post(`/api/tutor/registrations/${encodeURIComponent(pendingStudentId)}/approve`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(tutorApprovalAttempt.status).toBe(409);
    const studentCookie = cookieHeader(await studentLogin(first.code!, `${prefix}-pending-student-a`));
    const studentApprovalAttempt = await request(app)
      .post(`/api/tutor/registrations/${encodeURIComponent(pendingStudentId)}/approve`)
      .set('Cookie', studentCookie)
      .send({});
    expect(studentApprovalAttempt.status).toBe(403);
    const tutorOnTutorQueue = await request(app)
      .get('/api/org-admin/tutors/pending')
      .set('Cookie', tutorCookie);
    expect(tutorOnTutorQueue.status).toBe(403);
    const pendingStudents = await request(app)
      .get('/api/tutor/registrations?status=PENDING')
      .set('Cookie', tutorCookie);
    expect(pendingStudents.status).toBe(200);
    expect(pendingStudents.body.data.registrations.some((registration: { studentId: string }) => registration.studentId === pendingStudentId)).toBe(false);
    const acceptedTutors = await request(app)
      .get('/api/org-admin/tutors/registrations?status=APPROVED')
      .set('Cookie', cookieHeader(orgAdmin));
    expect(acceptedTutors.status).toBe(200);
    expect(acceptedTutors.body.data.registrations.some((registration: { user: { id: string } }) => registration.user.id === pendingTutorId)).toBe(true);

    const firstStudentLogin = await studentLogin(first.code!, 'DUPLICATE-ID');
    const secondStudentLogin = await studentLogin(second.code!, 'DUPLICATE-ID');
    expect(firstStudentLogin.status).toBe(200);
    expect(secondStudentLogin.status).toBe(200);
    const firstCourse = await prisma.course.create({
      data: {
        organizationId: first.id,
        createdById: adminA.id,
        code: `${prefix}-TUTOR-COURSE-A`,
        title: 'Tutor course A',
        category: 'Test',
        plannedHours: 1,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
      },
    });
    const secondCourse = await prisma.course.create({
      data: {
        organizationId: second.id,
        createdById: adminB.id,
        code: `${prefix}-TUTOR-COURSE-B`,
        title: 'Tutor course B',
        category: 'Test',
        plannedHours: 1,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
      },
    });
    await prisma.courseInstructor.createMany({
      data: [
        { organizationId: first.id, courseId: firstCourse.id, instructorId: pendingTutorId },
        { organizationId: second.id, courseId: secondCourse.id, instructorId: tutorB.id },
      ],
    });
    await prisma.enrollment.createMany({
      data: [
        { organizationId: first.id, courseId: firstCourse.id, studentId: studentA.id, selectedTutorId: pendingTutorId, status: 'ACTIVE' },
        { organizationId: second.id, courseId: secondCourse.id, studentId: studentB.id, selectedTutorId: tutorB.id, status: 'ACTIVE' },
      ],
    });
    const firstStudentList = await request(app).get('/api/students').set('Cookie', tutorCookie);
    expect(firstStudentList.status).toBe(200);
    const firstStudents = firstStudentList.body.data.students as Array<{ studentId: string; user: { email: string } }>;
    const firstIds = firstStudents.map((student) => student.studentId);
    expect(firstIds).toContain('DUPLICATE-ID');
    expect(firstStudents.some((student) => student.user.email === studentB.email)).toBe(false);
    const secondTutor = await tutorLogin(second.code!, tutorB.email);
    const secondStudentList = await request(app).get('/api/students').set('Cookie', cookieHeader(secondTutor));
    expect(secondStudentList.status).toBe(200);
    expect(secondStudentList.body.data.students).toHaveLength(1);

    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'isolation-superadmin');
    const superAdminLogin = await request(app).post('/api/auth/super-admin/login').send({ email: superAdmin.email, password });
    const superAdminStudentRead = await request(app).get('/api/students').set('Cookie', cookieHeader(superAdminLogin));
    expect(superAdminStudentRead.status).toBe(403);

    const crossTenantApprove = await request(app)
      .post('/api/tutor/registrations/B-ONLY-PENDING/approve')
      .set('Cookie', tutorCookie)
      .send({});
    expect(crossTenantApprove.status).toBe(404);
    expect([pendingStudentRegistration.body.data.user.id, pendingStudentB.id, studentA.id]).toHaveLength(3);
  });
});

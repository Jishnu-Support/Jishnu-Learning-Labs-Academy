import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, PrismaClient, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import * as approvalService from '../src/modules/approvals/approvals.service.js';
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
      ...(role === Role.STAFF && organizationId ? {
        staffProfile: {
          create: { organizationId, staffId: identifier ?? `${prefix}-${suffix}` },
        },
      } : {}),
      ...((role === Role.INSTRUCTOR || role === Role.STAFF) && organizationId ? {
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

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const value = response.headers['set-cookie'];
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map((item) => item.split(';')[0]).join('; ');
}

function studentLogin(organizationCode: string, studentId: string) {
  return request(app).post('/api/auth/students/login').send({ organizationCode, studentId, password });
}

function staffLogin(organizationCode: string, staffId: string) {
  return request(app).post('/api/auth/staff/login').send({ organizationCode, identifier: staffId, password });
}

function instructorLogin(organizationCode: string, email: string) {
  return request(app).post('/api/auth/instructors/login').send({ organizationCode, email, password });
}

function orgAdminLogin(organizationCode: string, email: string) {
  return request(app).post('/api/auth/org-admin/login').send({ organizationCode, email, password });
}

async function registerStudent(organizationCode: string, studentId: string, suffix: string) {
  const response = await request(app).post('/api/auth/students/register').send({
    organizationCode,
    studentId,
    name: `${suffix} Student`,
    email: `${prefix}-${suffix}@example.test`,
    phone: '+15555550124',
    password,
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
    expect(monitoredOrg.counts).toEqual({ students: 0, staff: 0, instructors: 0 });

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

  it('allows the same Student ID and Staff ID in separate organizations, but rejects duplicates within one', async () => {
    const first = await makeOrganization(`${prefix} First`, `${prefix}-first`);
    const second = await makeOrganization(`${prefix} Second`, `${prefix}-second`);

    const firstStudent = await registerStudent(first.code!, 'SHARED-100', 'first-student');
    const secondStudent = await registerStudent(second.code!, 'SHARED-100', 'second-student');
    const duplicateStudent = await registerStudent(first.code!, 'SHARED-100', 'duplicate-student');
    expect(firstStudent.status).toBe(201);
    expect(secondStudent.status).toBe(201);
    expect(duplicateStudent.status).toBe(409);

    const staffA = await request(app).post('/api/auth/staff/register').send({
      organizationCode: first.code, staffId: 'SHARED-STAFF', name: 'Staff A',
      email: `${prefix}-staff-a@example.test`, phone: '+15555550127', password,
    });
    const staffB = await request(app).post('/api/auth/staff/register').send({
      organizationCode: second.code, staffId: 'SHARED-STAFF', name: 'Staff B',
      email: `${prefix}-staff-b@example.test`, phone: '+15555550128', password,
    });
    const duplicateStaff = await request(app).post('/api/auth/staff/register').send({
      organizationCode: first.code, staffId: 'SHARED-STAFF', name: 'Staff Duplicate',
      email: `${prefix}-staff-duplicate@example.test`, phone: '+15555550129', password,
    });
    for (const response of [staffA, staffB]) {
      expect(response.status).toBe(201);
      createdUserIds.push(response.body.data.user.id as string);
    }
    expect(duplicateStaff.status).toBe(409);
  });

  it('enforces pending, rejected, and suspended login states and revokes older student sessions', async () => {
    const organization = await makeOrganization(`${prefix} Status`, `${prefix}-status`);
    const pending = await makeUser(organization.id, Role.STUDENT, 'pending', AccountStatus.PENDING, 'PENDING-ID');
    const rejected = await makeUser(organization.id, Role.STUDENT, 'rejected', AccountStatus.REJECTED, 'REJECTED-ID');
    const suspended = await makeUser(organization.id, Role.STUDENT, 'suspended', AccountStatus.SUSPENDED, 'SUSPENDED-ID');
    await makeUser(organization.id, Role.STAFF, 'rejected-staff', AccountStatus.REJECTED, 'REJECTED-STAFF');
    const suspendedInstructor = await makeUser(organization.id, Role.INSTRUCTOR, 'suspended-instructor', AccountStatus.SUSPENDED);
    const pendingLogin = await studentLogin(organization.code!, 'PENDING-ID');
    expect(pendingLogin.status).toBe(403);
    expect(pendingLogin.body.error.message).toContain('pending instructor approval');
    const rejectedLogin = await studentLogin(organization.code!, 'REJECTED-ID');
    expect(rejectedLogin.status).toBe(403);
    expect(rejectedLogin.body.error.message).toContain('Review the submitted information.');
    const suspendedLogin = await studentLogin(organization.code!, 'SUSPENDED-ID');
    expect(suspendedLogin.status).toBe(403);
    expect(suspendedLogin.body.error.message).toContain('suspended');
    const rejectedStaffLogin = await staffLogin(organization.code!, 'REJECTED-STAFF');
    expect(rejectedStaffLogin.status).toBe(403);
    expect(rejectedStaffLogin.body.error.message).toContain('Review the submitted information.');
    const suspendedInstructorLogin = await instructorLogin(organization.code!, suspendedInstructor.email);
    expect(suspendedInstructorLogin.status).toBe(403);
    expect(suspendedInstructorLogin.body.error.message).toContain('suspended');
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
      { user: await makeUser(organization.id, Role.INSTRUCTOR, 'me-instructor'), role: Role.INSTRUCTOR },
      { user: await makeUser(organization.id, Role.STAFF, 'me-staff', AccountStatus.APPROVED, 'ME-STAFF'), role: Role.STAFF },
      { user: await makeUser(organization.id, Role.STUDENT, 'me-student', AccountStatus.APPROVED, 'ME-STUDENT'), role: Role.STUDENT },
    ];

    for (const { user, role } of users) {
      const login = role === Role.SUPER_ADMIN
        ? await request(app).post('/api/auth/super-admin/login').send({ email: user.email, password })
        : role === Role.ORG_ADMIN
          ? await orgAdminLogin(organization.code!, user.email)
          : role === Role.INSTRUCTOR
            ? await instructorLogin(organization.code!, user.email)
            : role === Role.STAFF
              ? await staffLogin(organization.code!, 'ME-STAFF')
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
    const adminA = await makeUser(first.id, Role.ORG_ADMIN, 'admin-a');
    const adminB = await makeUser(second.id, Role.ORG_ADMIN, 'admin-b');
    const instructorB = await makeUser(second.id, Role.INSTRUCTOR, 'instructor-b');
    const studentA = await makeUser(first.id, Role.STUDENT, 'student-a', AccountStatus.APPROVED, 'DUPLICATE-ID');
    const studentB = await makeUser(second.id, Role.STUDENT, 'student-b', AccountStatus.APPROVED, 'DUPLICATE-ID');
    const pendingStudentB = await makeUser(second.id, Role.STUDENT, 'pending-student-b', AccountStatus.PENDING, 'B-ONLY-PENDING');

    const pendingInstructorRegistration = await request(app).post('/api/auth/instructors/register').send({
      organizationCode: first.code,
      name: 'Pending Instructor A',
      email: `${prefix}-pending-instructor-a@example.test`,
      phone: '+15555550126',
      password,
    });
    expect(pendingInstructorRegistration.status).toBe(201);
    const pendingInstructorId = pendingInstructorRegistration.body.data.user.id as string;
    createdUserIds.push(pendingInstructorId);
    const pendingStaffRegistration = await request(app).post('/api/auth/staff/register').send({
      organizationCode: first.code,
      staffId: `${prefix}-pending-staff-a`,
      name: 'Pending Staff A',
      email: `${prefix}-pending-staff-a@example.test`,
      phone: '+15555550127',
      password,
    });
    expect(pendingStaffRegistration.status).toBe(201);
    const pendingStaffId = pendingStaffRegistration.body.data.user.id as string;
    createdUserIds.push(pendingStaffId);
    const pendingStudentRegistration = await registerStudent(first.code!, `${prefix}-pending-student-a`, 'pending-student-a');
    expect(pendingStudentRegistration.status).toBe(201);
    const pendingStudentUserId = pendingStudentRegistration.body.data.user.id as string;
    const pendingStudentId = pendingStudentRegistration.body.data.user.studentProfile.studentId as string;

    const pendingInstructorEmail = `${prefix}-pending-instructor-a@example.test`;
    const pendingInstructorLogin = await instructorLogin(first.code!, pendingInstructorEmail);
    expect(pendingInstructorLogin.status).toBe(403);
    expect(pendingInstructorLogin.body.error.message).toContain('pending organization admin approval');
    const orgAdmin = await orgAdminLogin(first.code!, adminA.email);
    expect(orgAdmin.status).toBe(200);
    const orgAdminB = await orgAdminLogin(second.code!, adminB.email);
    expect(orgAdminB.status).toBe(200);
    const crossTenantInstructorApproval = await request(app)
      .post(`/api/org-admin/instructors/${pendingInstructorId}/approve`)
      .set('Cookie', cookieHeader(orgAdminB))
      .send({});
    expect(crossTenantInstructorApproval.status).toBe(404);
    const instructorApproval = await request(app)
      .post(`/api/org-admin/instructors/${pendingInstructorId}/approve`)
      .set('Cookie', cookieHeader(orgAdmin))
      .send({});
    expect(instructorApproval.status).toBe(200);
    const instructor = await instructorLogin(first.code!, pendingInstructorEmail);
    expect(instructor.status).toBe(200);

    const studentDenial = await request(app)
      .post(`/api/instructor/registrations/${prefix}-student-a/approve`)
      .set('Cookie', cookieHeader(orgAdmin))
      .send({});
    expect(studentDenial.status).toBe(403);

    const instructorCookie = cookieHeader(instructor);
    const instructorStaffApprovalAttempt = await request(app)
      .post(`/api/org-admin/staff/${pendingStaffId}/approve`)
      .set('Cookie', instructorCookie)
      .send({});
    expect(instructorStaffApprovalAttempt.status).toBe(403);
    const approveStudent = await request(app)
      .post(`/api/instructor/registrations/${encodeURIComponent(pendingStudentId)}/approve`)
      .set('Cookie', instructorCookie)
      .send({});
    expect(approveStudent.status).toBe(200);
    const approveStaff = await request(app)
      .post(`/api/org-admin/staff/${pendingStaffId}/approve`)
      .set('Cookie', cookieHeader(orgAdmin))
      .send({});
    expect(approveStaff.status).toBe(200);
    expect((await studentLogin(first.code!, `${prefix}-pending-student-a`)).status).toBe(200);
    expect((await staffLogin(first.code!, `${prefix}-pending-staff-a`)).status).toBe(200);

    const staffCookie = cookieHeader(await staffLogin(first.code!, `${prefix}-pending-staff-a`));
    const staffApprovalAttempt = await request(app)
      .post(`/api/instructor/registrations/${prefix}-student-a/approve`)
      .set('Cookie', staffCookie)
      .send({});
    expect(staffApprovalAttempt.status).toBe(403);
    const studentCookie = cookieHeader(await studentLogin(first.code!, `${prefix}-pending-student-a`));
    const studentApprovalAttempt = await request(app)
      .post(`/api/instructor/registrations/${prefix}-student-a/approve`)
      .set('Cookie', studentCookie)
      .send({});
    expect(studentApprovalAttempt.status).toBe(403);
    const instructorOnInstructorRoute = await request(app)
      .get('/api/org-admin/instructors/pending')
      .set('Cookie', instructorCookie);
    expect(instructorOnInstructorRoute.status).toBe(403);
    await expect(approvalService.approveInstructor(first.id, pendingInstructorId, pendingInstructorId))
      .rejects.toMatchObject({ status: 403 });

    const firstStudentLogin = await studentLogin(first.code!, 'DUPLICATE-ID');
    const secondStudentLogin = await studentLogin(second.code!, 'DUPLICATE-ID');
    expect(firstStudentLogin.status).toBe(200);
    expect(secondStudentLogin.status).toBe(200);
    const firstStudentList = await request(app).get('/api/students').set('Cookie', instructorCookie);
    expect(firstStudentList.status).toBe(200);
    const firstStudents = firstStudentList.body.data.students as Array<{ studentId: string; user: { email: string } }>;
    const firstIds = firstStudents.map((student) => student.studentId);
    expect(firstIds).toContain('DUPLICATE-ID');
    expect(firstStudents.some((student) => student.user.email === studentB.email)).toBe(false);
    const secondInstructor = await instructorLogin(second.code!, instructorB.email);
    const secondStudentList = await request(app).get('/api/students').set('Cookie', cookieHeader(secondInstructor));
    expect(secondStudentList.status).toBe(200);
    expect(secondStudentList.body.data.students).toHaveLength(2);

    const superAdmin = await makeUser(null, Role.SUPER_ADMIN, 'isolation-superadmin');
    const superAdminLogin = await request(app).post('/api/auth/super-admin/login').send({ email: superAdmin.email, password });
    const superAdminStudentRead = await request(app).get('/api/students').set('Cookie', cookieHeader(superAdminLogin));
    expect(superAdminStudentRead.status).toBe(403);

    const crossTenantApprove = await request(app)
      .post('/api/instructor/registrations/B-ONLY-PENDING/approve')
      .set('Cookie', instructorCookie)
      .send({});
    expect(crossTenantApprove.status).toBe(404);
    expect([pendingStudentUserId, pendingStudentB.id, studentA.id]).toHaveLength(3);
  });
});

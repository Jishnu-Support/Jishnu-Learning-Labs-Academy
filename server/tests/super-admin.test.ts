import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, PrismaClient, Role } from '@prisma/client';
import { app } from '../src/app.js';

const prisma = new PrismaClient();
const password = 'TestPass!1234';
const prefix = `super-admin-${Date.now()}`;
let organizationId = '';
let superAdminId = '';
let organizationAdminId = '';

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  if (organizationId) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  if (superAdminId || organizationAdminId) {
    await prisma.user.deleteMany({ where: { id: { in: [superAdminId, organizationAdminId].filter(Boolean) } } });
  }
  await prisma.$disconnect();
});

describe('Super Admin organization access and audit', () => {
  it('requires and audits a reason for tenant directories and restricts session audit to Super Admin', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${prefix} Academy`,
        code: `${prefix}-academy`,
        headName: 'Test Head',
        contactNumber: '+15555550100',
        email: `${prefix}@example.test`,
        address: '1 Test Street',
        city: 'Test City',
        state: 'Test State',
        country: 'Test Country',
        status: OrganizationStatus.ACTIVE,
      },
    });
    organizationId = organization.id;

    const admin = await prisma.user.create({
      data: {
        organizationId,
        email: `${prefix}-admin@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Directory Admin',
        role: Role.ORG_ADMIN,
        status: AccountStatus.APPROVED,
      },
    });
    organizationAdminId = admin.id;
    await prisma.user.create({
      data: {
        organizationId,
        email: `${prefix}-student@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Directory Student',
        role: Role.STUDENT,
        status: AccountStatus.APPROVED,
        studentProfile: { create: { organizationId, studentId: `${prefix}-student`, status: 'APPROVED' } },
      },
    });
    await prisma.user.create({
      data: {
        organizationId,
        email: `${prefix}-tutor@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Directory Tutor',
        role: Role.TUTOR,
        status: AccountStatus.APPROVED,
        tutorProfile: { create: { organizationId, tutorId: `${prefix}-tutor`, joiningDate: new Date() } },
      },
    });

    const superAdmin = await prisma.user.create({
      data: {
        email: `${prefix}-super@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Directory Super Admin',
        role: Role.SUPER_ADMIN,
        status: AccountStatus.APPROVED,
      },
    });
    superAdminId = superAdmin.id;

    const superAdminLogin = await request(app).post('/api/auth/super-admin/login').send({
      email: superAdmin.email,
      password,
    });
    expect(superAdminLogin.status).toBe(200);
    const superAdminCookie = cookieHeader(superAdminLogin);
    const directoryBase = `/api/super-admin/organizations/${organizationId}/directories`;
    const queryOnlyReason = await request(app).get(`${directoryBase}/students?reason=Reviewing%20support%20request`)
      .set('Cookie', superAdminCookie);
    expect(queryOnlyReason.status).toBe(400);

    const reason = 'Reviewing a documented support request';
    const students = await request(app).get(`${directoryBase}/students?page=1&pageSize=100`)
      .set('Cookie', superAdminCookie)
      .set('X-Access-Reason', reason);
    expect(students.status).toBe(200);
    expect(students.body.data.students).toEqual(expect.arrayContaining([
      expect.objectContaining({ user: expect.objectContaining({ name: 'Directory Student' }) }),
    ]));
    expect(JSON.stringify(students.body)).not.toMatch(/aadhaar|apaar/i);

    const tutors = await request(app).get(`${directoryBase}/tutors?page=1&pageSize=100`)
      .set('Cookie', superAdminCookie)
      .set('X-Access-Reason', reason);
    expect(tutors.status).toBe(200);
    expect(tutors.body.data.tutors).toEqual(expect.arrayContaining([
      expect.objectContaining({ user: expect.objectContaining({ name: 'Directory Tutor' }) }),
    ]));
    expect(await prisma.auditLog.count({
      where: { organizationId, actorId: superAdminId, action: 'SUPER_ADMIN_DIRECTORY_ACCESSED' },
    })).toBe(2);
    const directoryAudit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId, actorId: superAdminId, action: 'SUPER_ADMIN_DIRECTORY_ACCESSED' },
    });
    expect(directoryAudit.metadata).toMatchObject({ reason });

    const sessions = await request(app).get('/api/super-admin/audit/sessions?role=SUPER_ADMIN')
      .set('Cookie', superAdminCookie);
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ user: expect.objectContaining({ id: superAdminId, role: Role.SUPER_ADMIN }), active: true }),
    ]));

    const scopedBase = `/api/super-admin/organizations/${organizationId}`;
    for (const path of [
      '/courses',
      '/notes',
      '/media',
      '/learning/teacher/questions',
      '/learning/teacher/practice-sets',
      '/learning/teacher/assessments',
      '/portal/manage/sessions',
      '/portal/manage/library',
    ]) {
      const response = await request(app).get(`${scopedBase}${path}`).set('Cookie', superAdminCookie);
      expect(response.status, path).toBe(200);
    }

    const adminLogin = await request(app).post('/api/auth/org-admin/login').send({
      organizationCode: organization.code,
      email: admin.email,
      password,
    });
    expect(adminLogin.status).toBe(200);
    const forbiddenAudit = await request(app).get('/api/super-admin/audit/sessions')
      .set('Cookie', cookieHeader(adminLogin));
    expect(forbiddenAudit.status).toBe(403);
  });
});

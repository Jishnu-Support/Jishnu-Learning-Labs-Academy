import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { PrismaClient, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';

const prisma = new PrismaClient();
const password = 'TestPass!1234';
const prefix = `phase1-${Date.now()}`;
const createdUserIds: string[] = [];

async function makeUser(role: Role, suffix: string, status?: StudentStatus) {
  const user = await prisma.user.create({
    data: { email: `${prefix}-${suffix}@example.test`, name: `${suffix} Test`, role, passwordHash: await bcrypt.hash(password, 4) },
  });
  createdUserIds.push(user.id);
  if (role === Role.STUDENT) {
    await prisma.studentProfile.create({ data: { userId: user.id, studentId: `${prefix}-${suffix}`, status: status ?? StudentStatus.PENDING, rejectionReason: status === StudentStatus.REJECTED ? 'Ask your instructor.' : null } });
  }
  return user;
}

async function makeBatch(instructorId: string, studentIds: string[]) {
  const batch = await prisma.batch.create({ data: { name: `${prefix}-batch-${Math.random()}` } });
  await prisma.batchInstructor.create({ data: { batchId: batch.id, instructorId } });
  for (const studentId of studentIds) await prisma.batchStudent.create({ data: { batchId: batch.id, studentId } });
  return batch;
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const value = response.headers['set-cookie'];
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map((item) => item.split(';')[0]).join('; ');
}

async function studentLogin(studentId: string) {
  return request(app).post('/api/auth/students/login').send({ studentId, password });
}

async function portalLogin(portal: 'instructors' | 'staff', email: string) {
  return request(app).post(`/api/auth/${portal}/login`).send({ email, password });
}

beforeAll(async () => prisma.$connect());
afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('Phase 1 registration and authentication', () => {
  it('registers a student as PENDING', async () => {
    const response = await request(app).post('/api/auth/students/register').send({ studentId: `${prefix}-new`, name: 'New Learner', email: `${prefix}-new@example.test`, password });
    expect(response.status).toBe(201);
    expect(response.body.data.user.studentProfile.status).toBe(StudentStatus.PENDING);
    createdUserIds.push(response.body.data.user.id as string);
  });

  it('blocks PENDING, REJECTED and SUSPENDED students with distinct messages', async () => {
    for (const [suffix, status, message] of [
      ['pending', StudentStatus.PENDING, 'pending instructor approval'],
      ['rejected', StudentStatus.REJECTED, 'Ask your instructor.'],
      ['suspended', StudentStatus.SUSPENDED, 'account is suspended'],
    ] as const) {
      const user = await makeUser(Role.STUDENT, suffix, status);
      const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: user.id } });
      const response = await studentLogin(profile.studentId);
      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain(message);
    }
  });

  it('instructor approval allows the student to sign in', async () => {
    const instructor = await makeUser(Role.INSTRUCTOR, 'approver');
    const student = await makeUser(Role.STUDENT, 'to-approve');
    await makeBatch(instructor.id, [student.id]);
    const approvalLogin = await portalLogin('instructors', instructor.email);
    expect(approvalLogin.status).toBe(200);
    const studentProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const approval = await request(app).post(`/api/instructor/registrations/${studentProfile.studentId}/approve`).set('Cookie', cookieHeader(approvalLogin)).send({});
    expect(approval.status).toBe(200);
    expect((await studentLogin(studentProfile.studentId)).status).toBe(200);
  });

  it('records every credential login attempt', async () => {
    const student = await makeUser(Role.STUDENT, 'bad-password', StudentStatus.APPROVED);
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const response = await request(app).post('/api/auth/students/login').send({ studentId: profile.studentId, password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(await prisma.loginLog.count({ where: { userId: student.id, success: false } })).toBe(1);
  });

  it('revokes the previous active student session on a new login', async () => {
    const student = await makeUser(Role.STUDENT, 'single-session', StudentStatus.APPROVED);
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const first = await studentLogin(profile.studentId);
    const oldCookies = cookieHeader(first);
    const second = await studentLogin(profile.studentId);
    expect(second.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookies)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: student.id, revokedAt: null } })).toBe(1);
  });
});

describe('Phase 1 instructor permissions', () => {
  it('rejects staff and student approval attempts with 403', async () => {
    const staff = await makeUser(Role.STAFF, 'staff-denied');
    const student = await makeUser(Role.STUDENT, 'student-denied', StudentStatus.APPROVED);
    const pending = await makeUser(Role.STUDENT, 'pending-target');
    const pendingProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: pending.id } });
    const staffSession = await portalLogin('staff', staff.email);
    const studentProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const studentSession = await studentLogin(studentProfile.studentId);
    for (const cookie of [cookieHeader(staffSession), cookieHeader(studentSession)]) {
      const response = await request(app).post(`/api/instructor/registrations/${pendingProfile.studentId}/approve`).set('Cookie', cookie).send({});
      expect(response.status).toBe(403);
    }
  });

  it('shows only own-batch and unassigned pending students', async () => {
    const instructor = await makeUser(Role.INSTRUCTOR, 'scope-owner');
    const otherInstructor = await makeUser(Role.INSTRUCTOR, 'scope-other');
    const inBatch = await makeUser(Role.STUDENT, 'scope-in');
    const outsideBatch = await makeUser(Role.STUDENT, 'scope-out');
    const unassigned = await makeUser(Role.STUDENT, 'scope-free');
    await makeBatch(instructor.id, [inBatch.id]);
    await makeBatch(otherInstructor.id, [outsideBatch.id]);
    const session = await portalLogin('instructors', instructor.email);
    const response = await request(app).get('/api/instructor/registrations/pending').set('Cookie', cookieHeader(session));
    expect(response.status).toBe(200);
    const ids = (response.body.data.registrations as Array<{ studentId: string }>).map((item) => item.studentId);
    const profiles = await prisma.studentProfile.findMany({ where: { userId: { in: [inBatch.id, outsideBatch.id, unassigned.id] } } });
    const ownProfile = profiles.find((item) => item.userId === inBatch.id)!;
    const otherProfile = profiles.find((item) => item.userId === outsideBatch.id)!;
    const freeProfile = profiles.find((item) => item.userId === unassigned.id)!;
    expect(ids).toContain(ownProfile.studentId);
    expect(ids).toContain(freeProfile.studentId);
    expect(ids).not.toContain(otherProfile.studentId);
  });

  it('limits general student visibility to instructor-owned batches', async () => {
    const instructor = await makeUser(Role.INSTRUCTOR, 'list-owner');
    const otherInstructor = await makeUser(Role.INSTRUCTOR, 'list-other');
    const inBatch = await makeUser(Role.STUDENT, 'list-in');
    const outsideBatch = await makeUser(Role.STUDENT, 'list-out');
    await makeBatch(instructor.id, [inBatch.id]);
    await makeBatch(otherInstructor.id, [outsideBatch.id]);
    const session = await portalLogin('instructors', instructor.email);
    const response = await request(app).get('/api/students').set('Cookie', cookieHeader(session));
    expect(response.status).toBe(200);
    const ids = (response.body.data.students as Array<{ studentId: string }>).map((item) => item.studentId);
    const ownProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: inBatch.id } });
    const otherProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: outsideBatch.id } });
    expect(ids).toContain(ownProfile.studentId);
    expect(ids).not.toContain(otherProfile.studentId);
  });
});

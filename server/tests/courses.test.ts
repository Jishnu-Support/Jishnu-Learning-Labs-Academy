import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { PrismaClient, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';

const prisma = new PrismaClient();
const password = 'CourseTest!123';
const prefix = `phase2-${Date.now()}`;
const createdUserIds: string[] = [];

async function makeUser(role: Role, suffix: string, status?: StudentStatus) {
  const user = await prisma.user.create({
    data: { email: `${prefix}-${suffix}@example.test`, name: `${suffix} Test`, role, passwordHash: await bcrypt.hash(password, 4) },
  });
  createdUserIds.push(user.id);
  if (role === Role.STUDENT) await prisma.studentProfile.create({ data: { userId: user.id, studentId: `${prefix}-${suffix}`, status: status ?? StudentStatus.PENDING } });
  return user;
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const value = response.headers['set-cookie'];
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map((item) => item.split(';')[0]).join('; ');
}

async function login(role: 'instructors' | 'staff', email: string) {
  return request(app).post(`/api/auth/${role}/login`).send({ email, password });
}

beforeAll(async () => prisma.$connect());
afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.course.deleteMany({ where: { instructorId: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('Instructor course authoring', () => {
  it('creates, updates, publishes, unpublishes, and deletes an owned draft course', async () => {
    const instructor = await makeUser(Role.INSTRUCTOR, 'owner-flow');
    const session = await login('instructors', instructor.email);
    expect(session.status).toBe(200);
    const cookie = cookieHeader(session);

    const created = await request(app).post('/api/instructor/courses').set('Cookie', cookie).send({ title: 'Learning Foundations', description: 'A first course' });
    expect(created.status).toBe(201);
    expect(created.body.data.course.status).toBe('DRAFT');
    const courseId = created.body.data.course.id as string;

    const updated = await request(app).patch(`/api/instructor/courses/${courseId}`).set('Cookie', cookie).send({ title: 'Learning Foundations 101' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.course.title).toBe('Learning Foundations 101');

    const published = await request(app).post(`/api/instructor/courses/${courseId}/publish`).set('Cookie', cookie).send({});
    expect(published.body.data.course.status).toBe('PUBLISHED');
    expect((await request(app).delete(`/api/instructor/courses/${courseId}`).set('Cookie', cookie)).status).toBe(409);
    const unpublished = await request(app).post(`/api/instructor/courses/${courseId}/unpublish`).set('Cookie', cookie).send({});
    expect(unpublished.body.data.course.status).toBe('DRAFT');
    expect((await request(app).delete(`/api/instructor/courses/${courseId}`).set('Cookie', cookie)).status).toBe(204);
  });

  it('keeps an instructor from reading or editing another instructor’s course', async () => {
    const owner = await makeUser(Role.INSTRUCTOR, 'owner');
    const other = await makeUser(Role.INSTRUCTOR, 'other');
    const ownerCookie = cookieHeader(await login('instructors', owner.email));
    const otherCookie = cookieHeader(await login('instructors', other.email));
    const created = await request(app).post('/api/instructor/courses').set('Cookie', ownerCookie).send({ title: 'Private Course' });
    const courseId = created.body.data.course.id as string;

    expect((await request(app).get(`/api/instructor/courses/${courseId}`).set('Cookie', otherCookie)).status).toBe(404);
    expect((await request(app).patch(`/api/instructor/courses/${courseId}`).set('Cookie', otherCookie).send({ title: 'Hijacked title' })).status).toBe(404);
    const otherCourses = await request(app).get('/api/instructor/courses').set('Cookie', otherCookie);
    expect(otherCourses.body.data.courses).toHaveLength(0);
  });

  it('blocks students and staff from instructor course management', async () => {
    const staff = await makeUser(Role.STAFF, 'blocked-staff');
    const student = await makeUser(Role.STUDENT, 'blocked-student', StudentStatus.APPROVED);
    const staffCookie = cookieHeader(await login('staff', staff.email));
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const studentLogin = await request(app).post('/api/auth/students/login').send({ studentId: profile.studentId, password });

    for (const cookie of [staffCookie, cookieHeader(studentLogin)]) {
      expect((await request(app).get('/api/instructor/courses').set('Cookie', cookie)).status).toBe(403);
      expect((await request(app).post('/api/instructor/courses').set('Cookie', cookie).send({ title: 'Not allowed' })).status).toBe(403);
    }
  });

  it('validates course input', async () => {
    const instructor = await makeUser(Role.INSTRUCTOR, 'validation');
    const cookie = cookieHeader(await login('instructors', instructor.email));
    const response = await request(app).post('/api/instructor/courses').set('Cookie', cookie).send({ title: '  ' });
    expect(response.status).toBe(400);
  });
});

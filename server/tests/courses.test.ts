import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus,
  OrganizationStatus,
  PrismaClient,
  Role,
  StudentStatus,
  type User,
} from '@prisma/client';
import { app } from '../src/app.js';
import { seedCourses } from '../prisma/seed.js';

const prisma = new PrismaClient();
const password = 'CourseTest!1234';
const prefix = `courses-${Date.now()}`;
const organizationIds: string[] = [];

async function makeOrganization(suffix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`,
      code: `${prefix}-${suffix.toLowerCase()}`,
      headName: 'Course Test Head',
      contactNumber: '+15555550100',
      email: `${prefix}-${suffix.toLowerCase()}@example.test`,
      address: '10 Course Street',
      city: 'Course City',
      state: 'Test State',
      country: 'United States',
      status: OrganizationStatus.ACTIVE,
    },
  });
  organizationIds.push(organization.id);
  return organization;
}

async function makeUser(organizationId: string, role: Role, suffix: string): Promise<User> {
  return prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name: `${suffix} User`,
      role,
      status: AccountStatus.APPROVED,
      isActive: true,
      ...(role === Role.STUDENT ? {
        studentProfile: {
          create: {
            organizationId,
            studentId: `${prefix}-${suffix}`,
            status: StudentStatus.APPROVED,
          },
        },
      } : {}),
    },
  });
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function login(role: 'org-admin' | 'instructors' | 'students', organizationCode: string, user: User) {
  const endpoint = role === 'org-admin' ? '/api/auth/org-admin/login' : `/api/auth/${role}/login`;
  const body = role === 'students'
    ? {
      organizationCode,
      studentId: (await prisma.studentProfile.findUniqueOrThrow({ where: { userId: user.id }, select: { studentId: true } })).studentId,
      password,
    }
    : { organizationCode, email: user.email, password };
  const response = await request(app).post(endpoint).send(body);
  if (response.status !== 200) throw new Error(`Test login failed for ${user.email}: ${response.status}`);
  return cookieHeader(response);
}

function courseInput(code: string, instructorIds: string[]) {
  return {
    code,
    title: `Course ${code}`,
    description: 'A course description.',
    category: 'Test',
    plannedHours: 6,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    minimumAttendancePercent: 75,
    requiresAssessmentPass: true,
    instructorIds,
  };
}

let organization: Awaited<ReturnType<typeof makeOrganization>>;
let otherOrganization: Awaited<ReturnType<typeof makeOrganization>>;
let admin: User;
let instructor: User;
let otherInstructor: User;
let student: User;
let otherAdminCookie: string;
let adminCookie: string;
let instructorCookie: string;
let studentCookie: string;

beforeAll(async () => {
  await prisma.$connect();
  organization = await makeOrganization('primary');
  otherOrganization = await makeOrganization('other');
  admin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
  instructor = await makeUser(organization.id, Role.INSTRUCTOR, 'instructor');
  otherInstructor = await makeUser(otherOrganization.id, Role.INSTRUCTOR, 'other-instructor');
  student = await makeUser(organization.id, Role.STUDENT, 'student');
  const otherAdmin = await makeUser(otherOrganization.id, Role.ORG_ADMIN, 'other-admin');
  adminCookie = await login('org-admin', organization.code!, admin);
  instructorCookie = await login('instructors', organization.code!, instructor);
  studentCookie = await login('students', organization.code!, student);
  otherAdminCookie = await login('org-admin', otherOrganization.code!, otherAdmin);
});

afterAll(async () => {
  if (organizationIds.length) {
    await prisma.course.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.note.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.$disconnect();
});

describe('course management and student enrollment', () => {
  it('creates tenant-scoped courses, enforces organization-unique codes, and protects instructor ownership', async () => {
    const created = await request(app).post('/api/courses').set('Cookie', adminCookie).send(courseInput('FOUNDATION-1', [instructor.id]));
    expect(created.status).toBe(201);
    const duplicate = await request(app).post('/api/courses').set('Cookie', adminCookie).send(courseInput('FOUNDATION-1', [instructor.id]));
    expect(duplicate.status).toBe(409);
    const otherTenantSameCode = await request(app).post('/api/courses').set('Cookie', otherAdminCookie).send(courseInput('FOUNDATION-1', [otherInstructor.id]));
    expect(otherTenantSameCode.status).toBe(201);

    const draft = await request(app).post('/api/courses').set('Cookie', adminCookie).send(courseInput('DRAFT-1', [instructor.id]));
    const visibleToAssignedInstructor = await request(app).get('/api/courses').set('Cookie', instructorCookie);
    expect(visibleToAssignedInstructor.body.data.courses.map((course: { id: string }) => course.id)).toContain(created.body.data.course.id);
    expect(visibleToAssignedInstructor.body.data.courses.map((course: { id: string }) => course.id)).not.toContain(otherTenantSameCode.body.data.course.id);

    const secondInstructor = await makeUser(organization.id, Role.INSTRUCTOR, 'unassigned-instructor');
    const secondInstructorCookie = await login('instructors', organization.code!, secondInstructor);
    expect((await request(app).get(`/api/courses/${draft.body.data.course.id}`).set('Cookie', secondInstructorCookie)).status).toBe(404);
    expect((await request(app).patch(`/api/courses/${draft.body.data.course.id}`).set('Cookie', secondInstructorCookie).send({ title: 'Forbidden update' })).status).toBe(404);
    expect((await request(app).get(`/api/courses/${created.body.data.course.id}`).set('Cookie', studentCookie)).status).toBe(403);
  });

  it('keeps drafts hidden, calculates topic progress, searches enrollment by student ID, and blocks duplicate enrollment', async () => {
    const draft = await request(app).post('/api/courses').set('Cookie', adminCookie).send(courseInput('PROGRESS-1', [instructor.id]));
    const courseId = draft.body.data.course.id as string;
    await request(app).post(`/api/courses/${courseId}/topics`).set('Cookie', instructorCookie).send({ title: 'Topic one', plannedHours: 3 });
    const secondTopic = await request(app).post(`/api/courses/${courseId}/topics`).set('Cookie', instructorCookie).send({ title: 'Topic two', plannedHours: 3 });
    const draftBrowse = await request(app).get('/api/student/courses/browse').set('Cookie', studentCookie);
    expect(draftBrowse.body.data.courses.map((course: { id: string }) => course.id)).not.toContain(courseId);

    expect((await request(app).post(`/api/courses/${courseId}/publish`).set('Cookie', instructorCookie)).status).toBe(200);
    const enrolled = await request(app).post(`/api/student/courses/${courseId}/enroll`).set('Cookie', studentCookie);
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data.enrollment.status).toBe('ACTIVE');
    expect((await request(app).post(`/api/student/courses/${courseId}/enroll`).set('Cookie', studentCookie)).status).toBe(409);
    const initialDetail = await request(app).get(`/api/student/courses/${courseId}`).set('Cookie', studentCookie);
    expect(initialDetail.body.data.course.progressPercent).toBe(0);

    await request(app).patch(`/api/courses/${courseId}/topics/${secondTopic.body.data.topic.id}`).set('Cookie', instructorCookie).send({ covered: true });
    const updatedDetail = await request(app).get(`/api/student/courses/${courseId}`).set('Cookie', studentCookie);
    expect(updatedDetail.body.data.course.progressPercent).toBe(50);
    expect(updatedDetail.body.data.course.topics[1].covered).toBe(true);

    const studentId = student.email.includes('student') ? `${prefix}-student` : '';
    const enrollmentSearch = await request(app).get(`/api/courses/${courseId}/enrollments?search=${encodeURIComponent(studentId)}`).set('Cookie', instructorCookie);
    expect(enrollmentSearch.body.data.enrollments).toHaveLength(1);
    expect(enrollmentSearch.body.data.enrollments[0].student.studentProfile.studentId).toBe(studentId);

    const crossTenant = await request(app).get(`/api/student/courses/${courseId}`).set('Cookie', await login('students', otherOrganization.code!, await makeUser(otherOrganization.id, Role.STUDENT, 'other-student')));
    expect(crossTenant.status).toBe(404);
  });

  it('seeds six course fixtures per organization idempotently without deleting unlinked notes', async () => {
    const untouchedNote = await prisma.note.create({
      data: {
        organizationId: organization.id,
        authorId: admin.id,
        title: `${prefix} unlinked note`,
        subject: 'Test',
        description: 'Must remain after seeding.',
      },
    });
    await seedCourses(prisma, organization, admin, [instructor], [student]);
    const firstCounts = {
      courses: await prisma.course.count({ where: { organizationId: organization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101'] } } }),
      assessments: await prisma.assessment.count({ where: { organizationId: organization.id } }),
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: organization.id } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: organization.id } }),
      notes: await prisma.note.count({ where: { organizationId: organization.id } }),
    };
    await seedCourses(prisma, organization, admin, [instructor], [student]);
    const secondCounts = {
      courses: await prisma.course.count({ where: { organizationId: organization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101'] } } }),
      assessments: await prisma.assessment.count({ where: { organizationId: organization.id } }),
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: organization.id } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: organization.id } }),
      notes: await prisma.note.count({ where: { organizationId: organization.id } }),
    };
    expect(firstCounts).toEqual({ courses: 6, assessments: 6, assessmentQuestions: 24, practiceQuestions: 24, notes: 7 });
    expect(secondCounts).toEqual(firstCounts);
    expect(await prisma.note.findUnique({ where: { id: untouchedNote.id } })).not.toBeNull();
    const seededCourseIds = await prisma.course.findMany({
      where: { organizationId: organization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101'] } },
      select: { id: true },
    });
    expect(await prisma.enrollment.count({
      where: { organizationId: organization.id, studentId: student.id, courseId: { in: seededCourseIds.map(({ id }) => id) } },
    })).toBe(4);
  });
});

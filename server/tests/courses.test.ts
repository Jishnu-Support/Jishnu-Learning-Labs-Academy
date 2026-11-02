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

async function makeUser(
  organizationId: string,
  role: Role,
  suffix: string,
  status: AccountStatus = AccountStatus.APPROVED,
): Promise<User> {
  return prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name: `${suffix} User`,
      role,
      status,
      isActive: true,
      ...(role === Role.STUDENT ? {
        studentProfile: {
          create: {
            organizationId,
            studentId: `${prefix}-${suffix}`,
            status: status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.PENDING,
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
let secondInstructor: User;
let otherInstructor: User;
let student: User;
let secondStudent: User;
let northstarStudent: User;
let northstarPendingStudent: User;
let otherAdmin: User;
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
  secondInstructor = await makeUser(organization.id, Role.INSTRUCTOR, 'second-instructor');
  otherInstructor = await makeUser(otherOrganization.id, Role.INSTRUCTOR, 'other-instructor');
  student = await makeUser(organization.id, Role.STUDENT, 'student');
  secondStudent = await makeUser(organization.id, Role.STUDENT, 'second-student');
  northstarStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'northstar-student');
  northstarPendingStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'northstar-pending', AccountStatus.PENDING);
  otherAdmin = await makeUser(otherOrganization.id, Role.ORG_ADMIN, 'other-admin');
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

  it('seeds all twelve course fixtures idempotently without deleting or overwriting seeded data', async () => {
    const untouchedNote = await prisma.note.create({
      data: {
        organizationId: organization.id,
        authorId: admin.id,
        title: `${prefix} unlinked note`,
        subject: 'Test',
        description: 'Must remain after seeding.',
      },
    });
    await seedCourses(prisma, { ...organization, code: 'jll-demo' }, admin, [instructor, secondInstructor], [student, secondStudent]);
    const seededCourseIds = await prisma.course.findMany({
      where: { organizationId: organization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101', 'PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'] } },
      select: { id: true },
    });
    const seededAssessmentIds = (await prisma.assessment.findMany({
      where: { organizationId: organization.id, courseId: { in: seededCourseIds.map(({ id }) => id) } },
      select: { id: true },
    })).map(({ id }) => id);
    const firstCounts = {
      courses: seededCourseIds.length,
      topics: await prisma.courseTopic.count({ where: { organizationId: organization.id, courseId: { in: seededCourseIds.map(({ id }) => id) } } }),
      assessments: seededAssessmentIds.length,
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: organization.id, assessmentId: { in: seededAssessmentIds } } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: organization.id, courseId: { in: seededCourseIds.map(({ id }) => id) } } }),
      notes: await prisma.note.count({ where: { organizationId: organization.id, OR: [{ courseId: { in: seededCourseIds.map(({ id }) => id) } }, { id: untouchedNote.id }] } }),
    };
    const editedCourse = await prisma.course.findUniqueOrThrow({
      where: { organizationId_code: { organizationId: organization.id, code: 'SAP101' } },
    });
    const editedTopic = await prisma.courseTopic.findUniqueOrThrow({
      where: { organizationId_courseId_order: { organizationId: organization.id, courseId: editedCourse.id, order: 1 } },
    });
    const editedNote = await prisma.note.findFirstOrThrow({
      where: { organizationId: organization.id, courseId: editedCourse.id, title: `${organization.name} SAP course notes` },
    });
    const editedEnrollment = await prisma.enrollment.findUniqueOrThrow({
      where: { organizationId_courseId_studentId: { organizationId: organization.id, courseId: editedCourse.id, studentId: student.id } },
    });
    await prisma.course.update({
      where: { id: editedCourse.id },
      data: { title: 'User-edited SAP course', description: 'Preserve this description.', status: 'ARCHIVED' },
    });
    await prisma.courseTopic.update({ where: { id: editedTopic.id }, data: { title: 'User-edited topic', covered: true } });
    await prisma.note.update({ where: { id: editedNote.id }, data: { description: 'Preserve this note edit.' } });
    await prisma.enrollment.update({ where: { id: editedEnrollment.id }, data: { status: 'DROPPED' } });

    await seedCourses(prisma, { ...organization, code: 'jll-demo' }, admin, [instructor, secondInstructor], [student, secondStudent]);
    await seedCourses(prisma, { ...otherOrganization, code: 'northstar-academy' }, otherAdmin, [otherInstructor], [northstarStudent, northstarPendingStudent]);
    const northstarCoursesAfterFirstSeed = await prisma.course.findMany({
      where: { organizationId: otherOrganization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101', 'PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'] } },
      select: { id: true },
    });
    const northstarAssessmentIds = (await prisma.assessment.findMany({
      where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterFirstSeed.map(({ id }) => id) } },
      select: { id: true },
    })).map(({ id }) => id);
    const firstNorthstarCounts = {
      courses: northstarCoursesAfterFirstSeed.length,
      assessments: northstarAssessmentIds.length,
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: otherOrganization.id, assessmentId: { in: northstarAssessmentIds } } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterFirstSeed.map(({ id }) => id) } } }),
      notes: await prisma.note.count({ where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterFirstSeed.map(({ id }) => id) } } }),
    };
    await seedCourses(prisma, { ...otherOrganization, code: 'northstar-academy' }, otherAdmin, [otherInstructor], [northstarStudent, northstarPendingStudent]);
    const northstarCoursesAfterSecondSeed = await prisma.course.findMany({
      where: { organizationId: otherOrganization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101', 'PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'] } },
      select: { id: true },
    });
    const secondNorthstarAssessmentIds = (await prisma.assessment.findMany({
      where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterSecondSeed.map(({ id }) => id) } },
      select: { id: true },
    })).map(({ id }) => id);
    expect({
      courses: northstarCoursesAfterSecondSeed.length,
      assessments: secondNorthstarAssessmentIds.length,
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: otherOrganization.id, assessmentId: { in: secondNorthstarAssessmentIds } } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterSecondSeed.map(({ id }) => id) } } }),
      notes: await prisma.note.count({ where: { organizationId: otherOrganization.id, courseId: { in: northstarCoursesAfterSecondSeed.map(({ id }) => id) } } }),
    }).toEqual(firstNorthstarCounts);
    const secondCounts = {
      courses: await prisma.course.count({ where: { organizationId: organization.id, id: { in: seededCourseIds.map(({ id }) => id) } } }),
      topics: await prisma.courseTopic.count({ where: { organizationId: organization.id, courseId: { in: seededCourseIds.map(({ id }) => id) } } }),
      assessments: await prisma.assessment.count({ where: { organizationId: organization.id, id: { in: seededAssessmentIds } } }),
      assessmentQuestions: await prisma.assessmentQuestion.count({ where: { organizationId: organization.id, assessmentId: { in: seededAssessmentIds } } }),
      practiceQuestions: await prisma.practiceQuestion.count({ where: { organizationId: organization.id, courseId: { in: seededCourseIds.map(({ id }) => id) } } }),
      notes: await prisma.note.count({ where: { organizationId: organization.id, OR: [{ courseId: { in: seededCourseIds.map(({ id }) => id) } }, { id: untouchedNote.id }] } }),
    };
    expect(firstCounts).toEqual({ courses: 12, topics: 64, assessments: 12, assessmentQuestions: 60, practiceQuestions: 60, notes: 13 });
    expect(secondCounts).toEqual(firstCounts);
    expect(await prisma.course.findUniqueOrThrow({ where: { id: editedCourse.id } })).toMatchObject({
      title: 'User-edited SAP course',
      description: 'Preserve this description.',
      status: 'PUBLISHED',
    });
    expect((await prisma.courseTopic.findUniqueOrThrow({ where: { id: editedTopic.id } })).title).toBe('User-edited topic');
    expect((await prisma.note.findUniqueOrThrow({ where: { id: editedNote.id } })).description).toBe('Preserve this note edit.');
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: editedEnrollment.id } })).status).toBe('DROPPED');
    expect(await prisma.note.findUnique({ where: { id: untouchedNote.id } })).not.toBeNull();
    expect(await prisma.enrollment.count({
      where: { organizationId: organization.id, studentId: student.id, courseId: { in: seededCourseIds.map(({ id }) => id) } },
    })).toBe(7);
    const programmingCourses = await prisma.course.findMany({
      where: { organizationId: organization.id, code: { in: ['PY101', 'JAV101'] } },
      select: { id: true },
    });
    expect(await prisma.enrollment.count({
      where: { organizationId: organization.id, studentId: secondStudent.id, courseId: { in: programmingCourses.map(({ id }) => id) } },
    })).toBe(2);

    for (const seedOrganization of [organization, otherOrganization]) {
      const seededCourses = await prisma.course.findMany({
        where: { organizationId: seedOrganization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101', 'PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'] } },
        select: { id: true, code: true, plannedHours: true, category: true },
      });
      expect(seededCourses).toHaveLength(12);
      for (const course of seededCourses) {
        const newCourseDetails: Record<string, { plannedHours: number; category: string }> = {
          PY101: { plannedHours: 40, category: 'Programming' },
          CPP101: { plannedHours: 45, category: 'Programming' },
          JAV101: { plannedHours: 45, category: 'Programming' },
          JS101: { plannedHours: 40, category: 'Web Development' },
          HTML101: { plannedHours: 20, category: 'Web Development' },
          CSS101: { plannedHours: 25, category: 'Web Development' },
        };
        if (newCourseDetails[course.code]) {
          expect(course).toMatchObject(newCourseDetails[course.code]);
          const topics = await prisma.courseTopic.findMany({
            where: { organizationId: seedOrganization.id, courseId: course.id },
            orderBy: { order: 'asc' },
          });
          expect(topics.reduce((total, topic) => total + topic.plannedHours, 0)).toBe(course.plannedHours);
        }
        const practiceTypes = await prisma.practiceQuestion.findMany({
          where: { organizationId: seedOrganization.id, courseId: course.id },
          select: { type: true },
        });
        expect(new Set(practiceTypes.map(({ type }) => type))).toEqual(new Set(['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'MATCH', 'FILL_IN_BLANK']));
        const assessment = await prisma.assessment.findFirstOrThrow({
          where: { organizationId: seedOrganization.id, courseId: course.id, status: 'PUBLISHED' },
        });
        const assessmentTypes = await prisma.assessmentQuestion.findMany({
          where: { organizationId: seedOrganization.id, assessmentId: assessment.id },
          select: { type: true },
        });
        expect(new Set(assessmentTypes.map(({ type }) => type))).toEqual(new Set(['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'MATCH', 'FILL_IN_BLANK']));
        if (['PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'].includes(course.code)) {
          expect(await prisma.note.count({ where: { organizationId: seedOrganization.id, courseId: course.id } })).toBeGreaterThan(0);
        }
      }
    }

    const northstarCpp = await prisma.course.findUniqueOrThrow({
      where: { organizationId_code: { organizationId: otherOrganization.id, code: 'CPP101' } },
    });
    const northstarSeedCourses = await prisma.course.findMany({
      where: { organizationId: otherOrganization.id, code: { in: ['SAP101', 'ENG101', 'TAM101', 'MAT101', 'SOC101', 'SCI101', 'PY101', 'CPP101', 'JAV101', 'JS101', 'HTML101', 'CSS101'] } },
      select: { id: true },
    });
    const northstarSeedCourseIds = northstarSeedCourses.map(({ id }) => id);
    const northstarAssessments = await prisma.assessment.findMany({
      where: { organizationId: otherOrganization.id, courseId: { in: northstarSeedCourseIds } },
      select: { id: true },
    });
    expect(northstarSeedCourses).toHaveLength(12);
    expect(northstarAssessments).toHaveLength(12);
    expect(await prisma.assessmentQuestion.count({
      where: { organizationId: otherOrganization.id, assessmentId: { in: northstarAssessments.map(({ id }) => id) } },
    })).toBe(60);
    expect(await prisma.practiceQuestion.count({
      where: { organizationId: otherOrganization.id, courseId: { in: northstarSeedCourseIds } },
    })).toBe(60);
    expect(await prisma.note.count({
      where: { organizationId: otherOrganization.id, courseId: { in: northstarSeedCourseIds } },
    })).toBe(12);
    expect(await prisma.enrollment.count({
      where: { organizationId: otherOrganization.id, courseId: northstarCpp.id, studentId: northstarStudent.id },
    })).toBe(1);
    expect(await prisma.enrollment.count({
      where: { organizationId: otherOrganization.id, studentId: northstarPendingStudent.id },
    })).toBe(0);
  });
});

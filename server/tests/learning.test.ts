import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus, CourseStatus, OrganizationStatus,
  PrismaClient, Role, StudentStatus,
} from '@prisma/client';
import { app } from '../src/app.js';

const prisma = new PrismaClient();
const password = 'LearningTest!1234';
const prefix = `learning-${Date.now()}`;
const organizationIds: string[] = [];

async function makeOrganization(suffix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`, code: `${prefix}-${suffix}`, headName: 'Learning Test',
      contactNumber: '+15555550101', email: `${prefix}-${suffix}@example.test`,
      address: 'Learning Street', city: 'Test City', state: 'Test State', country: 'Test',
      status: OrganizationStatus.ACTIVE,
    },
  });
  organizationIds.push(organization.id);
  return organization;
}

async function makeUser(organizationId: string, role: Role, name: string) {
  return prisma.user.create({
    data: {
      organizationId, email: `${prefix}-${name}@example.test`, passwordHash: await bcrypt.hash(password, 4),
      name, role, status: AccountStatus.APPROVED, isActive: true,
      ...(role === Role.STUDENT ? { studentProfile: { create: { organizationId, studentId: `${prefix}-${name}`, status: StudentStatus.APPROVED } } } : {}),
      ...(role === Role.STAFF ? { staffProfile: { create: { organizationId, staffId: `${prefix}-${name}` } } } : {}),
    },
  });
}

function cookie(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : values ? [values] : []).map((value) => value.split(';')[0]).join('; ');
}

async function login(role: 'org-admin' | 'instructors' | 'students' | 'staff', code: string, user: Awaited<ReturnType<typeof makeUser>>) {
  const path = role === 'org-admin' ? '/api/auth/org-admin/login' : `/api/auth/${role}/login`;
  const identifier = role === 'staff'
    ? (await prisma.staffProfile.findUniqueOrThrow({ where: { userId: user.id }, select: { staffId: true } })).staffId
    : '';
  const payload = role === 'students'
    ? { organizationCode: code, studentId: `${prefix}-${user.name}`, password }
    : role === 'staff'
      ? { organizationCode: code, identifier, password }
      : { organizationCode: code, email: user.email, password };
  const response = await request(app).post(path).send(payload);
  if (response.status !== 200) throw new Error(`Test login failed for ${user.name}`);
  return cookie(response);
}

let organization: Awaited<ReturnType<typeof makeOrganization>>;
let otherOrganization: Awaited<ReturnType<typeof makeOrganization>>;
let admin: Awaited<ReturnType<typeof makeUser>>;
let instructor: Awaited<ReturnType<typeof makeUser>>;
let unassignedInstructor: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;
let otherStudent: Awaited<ReturnType<typeof makeUser>>;
let staff: Awaited<ReturnType<typeof makeUser>>;
let courseId: string;
let adminCookie = '';
let instructorCookie = '';
let studentCookie = '';
let otherStudentCookie = '';
let staffCookie = '';

beforeAll(async () => {
  await prisma.$connect();
  organization = await makeOrganization('primary');
  otherOrganization = await makeOrganization('other');
  admin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
  instructor = await makeUser(organization.id, Role.INSTRUCTOR, 'instructor');
  unassignedInstructor = await makeUser(organization.id, Role.INSTRUCTOR, 'unassigned');
  student = await makeUser(organization.id, Role.STUDENT, 'student');
  otherStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'other-student');
  staff = await makeUser(organization.id, Role.STAFF, 'staff');
  const course = await prisma.course.create({
    data: {
      organizationId: organization.id, code: `${prefix}-COURSE`, title: 'Learning test course',
      category: 'Test', plannedHours: 4, startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2027-01-01T00:00:00.000Z'), status: CourseStatus.PUBLISHED,
      createdById: admin.id,
    },
  });
  courseId = course.id;
  await prisma.courseInstructor.create({ data: { organizationId: organization.id, courseId, instructorId: instructor.id } });
  await prisma.enrollment.create({ data: { organizationId: organization.id, courseId, studentId: student.id } });
  adminCookie = await login('org-admin', organization.code!, admin);
  instructorCookie = await login('instructors', organization.code!, instructor);
  studentCookie = await login('students', organization.code!, student);
  otherStudentCookie = await login('students', otherOrganization.code!, otherStudent);
  staffCookie = await login('staff', organization.code!, staff);
});

afterAll(async () => {
  if (organizationIds.length) {
    await prisma.course.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.$disconnect();
});

const question = (overrides: Record<string, unknown> = {}) => ({
  courseId, type: 'MCQ_SINGLE', prompt: 'Which option is correct?', options: ['A', 'B'],
  correctAnswer: 'A', topic: 'Fundamentals', difficulty: 'BEGINNER', marks: 1,
  explanation: 'A is correct.', ...overrides,
});

async function createAssessment(cookieValue: string, options: { mode?: 'IMMEDIATE' | 'MANUAL'; maxAttempts?: number; questionSet?: unknown[] } = {}) {
  const questions = options.questionSet ?? [question({ marks: 2 })];
  const response = await request(app).post('/api/learning/teacher/assessments').set('Cookie', cookieValue).send({
    courseId, title: `${prefix} assessment`, instructions: 'Answer the questions.',
    totalMarks: questions.reduce((sum: number, item) => sum + Number((item as { marks: number }).marks), 0),
    passMark: 1, durationMinutes: 20, maxAttempts: options.maxAttempts ?? 1,
    shuffleQuestions: false, shuffleOptions: false, resultReleaseMode: options.mode ?? 'IMMEDIATE',
    answerReviewAllowed: true, questions,
  });
  expect(response.status).toBe(201);
  return response.body.data.assessment as { id: string };
}

describe('SP1 practice and assessment workflows', () => {
  it('limits teacher question management by role and assigned course', async () => {
    const created = await request(app).post('/api/learning/teacher/questions').set('Cookie', instructorCookie).send(question());
    expect(created.status).toBe(201);
    expect((await request(app).get('/api/learning/teacher/questions').set('Cookie', studentCookie)).status).toBe(403);
    expect((await request(app).get('/api/learning/teacher/questions').set('Cookie', staffCookie)).status).toBe(403);

    const otherCourse = await prisma.course.create({
      data: {
        organizationId: organization.id, code: `${prefix}-UNASSIGNED`, title: 'Unassigned course',
        category: 'Test', plannedHours: 1, startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'), status: CourseStatus.PUBLISHED, createdById: admin.id,
      },
    });
    const forbidden = await request(app).post('/api/learning/teacher/questions').set('Cookie', await login('instructors', organization.code!, unassignedInstructor)).send(question({ courseId: otherCourse.id }));
    expect(forbidden.status).toBe(404);
  });

  it('keeps practice answers private until submission and scopes practice history to the student', async () => {
    const saved = await request(app).post('/api/learning/teacher/questions').set('Cookie', adminCookie).send(question());
    const started = await request(app).post('/api/learning/student/practice/start').set('Cookie', studentCookie).send({ courseId, count: 1 });
    expect(started.status).toBe(201);
    const currentQuestion = started.body.data.question as Record<string, unknown>;
    expect(currentQuestion).not.toHaveProperty('correctAnswer');
    expect(currentQuestion).not.toHaveProperty('explanation');
    const sessionId = (started.body.data.session as { id: string }).id;
    expect((await request(app).get(`/api/learning/student/practice-sessions/${sessionId}`).set('Cookie', otherStudentCookie)).status).toBe(404);
    const answered = await request(app).post(`/api/learning/student/practice-sessions/${sessionId}/answers`).set('Cookie', studentCookie).send({
      questionId: currentQuestion.id, answer: 'A',
    });
    expect(answered.status).toBe(200);
    expect(answered.body.data.isCorrect).toBe(true);
    expect(answered.body.data.correctAnswer).toBe('A');
    expect(answered.body.data.explanation).toBe('A is correct.');
    expect(saved.status).toBe(201);
  });

  it('publishes immutable snapshots, grades on the server, and enforces attempt limits', async () => {
    const assessment = await createAssessment(instructorCookie);
    expect((await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', instructorCookie)).status).toBe(200);
    expect((await request(app).patch(`/api/learning/teacher/assessments/${assessment.id}`).set('Cookie', instructorCookie).send({ title: 'Changed' })).status).toBe(409);
    const attemptResponse = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    expect(attemptResponse.status).toBe(201);
    const attempt = attemptResponse.body.data.attempt as { id: string; questions: Array<Record<string, unknown>> };
    expect(attempt.questions[0]).not.toHaveProperty('correctAnswer');
    expect(attempt.questions[0]).not.toHaveProperty('explanation');
    const resumed = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    expect(resumed.body.data.attempt.id).toBe(attempt.id);
    expect((await request(app).post(`/api/learning/student/attempts/${attempt.id}/events`).set('Cookie', studentCookie).send({ eventType: 'TAB_SWITCH' })).status).toBe(204);
    expect((await request(app).put(`/api/learning/student/attempts/${attempt.id}/answers`).set('Cookie', studentCookie).send({ questionId: attempt.questions[0]!.id, answer: 'A' })).status).toBe(200);
    const submitted = await request(app).post(`/api/learning/student/attempts/${attempt.id}/submit`).set('Cookie', studentCookie);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.attempt.score).toBe(2);
    expect(submitted.body.data.attempt.questions[0]).toHaveProperty('correctAnswer', 'A');
    expect((await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie)).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'ASSESSMENT_PUBLISHED', targetId: assessment.id } })).toBe(1);
    const results = await request(app).get(`/api/learning/teacher/assessments/${assessment.id}/results`).set('Cookie', instructorCookie);
    expect(results.body.data.attempts[0].flagged).toBe(true);
    expect(results.body.data.attempts[0].flaggedEvents).toHaveLength(1);
    const regraded = await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/results/regrade`).set('Cookie', instructorCookie).send({
      questionId: attempt.questions[0]!.id, correctAnswer: 'B',
    });
    expect(regraded.status).toBe(200);
    expect((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).score).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'ASSESSMENT_QUESTION_REGRADED', targetId: assessment.id } })).toBe(1);
  });

  it('withholds manually released scores and grades match/fill blanks with partial credit', async () => {
    const assessment = await createAssessment(adminCookie, {
      mode: 'MANUAL',
      questionSet: [
        question({ type: 'MATCH', prompt: 'Match terms.', options: [{ left: 'A', right: 'Apple' }, { left: 'B', right: 'Ball' }], correctAnswer: { A: 'Apple', B: 'Ball' }, marks: 2 }),
        question({ type: 'FILL_BLANK', prompt: 'Fill two blanks.', options: null, correctAnswer: ['red', 'blue'], marks: 2 }),
      ],
    });
    expect((await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', adminCookie)).status).toBe(200);
    const started = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    const attempt = started.body.data.attempt as { id: string; questions: Array<Record<string, unknown>> };
    await request(app).put(`/api/learning/student/attempts/${attempt.id}/answers`).set('Cookie', studentCookie).send({ questionId: attempt.questions[0]!.id, answer: { A: 'Apple', B: 'Wrong' } });
    await request(app).put(`/api/learning/student/attempts/${attempt.id}/answers`).set('Cookie', studentCookie).send({ questionId: attempt.questions[1]!.id, answer: ['red', 'wrong'] });
    const submitted = await request(app).post(`/api/learning/student/attempts/${attempt.id}/submit`).set('Cookie', studentCookie);
    expect(submitted.body.data.attempt.score).toBeNull();
    expect((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).score).toBe(2);
    const studentList = await request(app).get('/api/learning/student/assessments').set('Cookie', studentCookie);
    expect(studentList.body.data.assessments.find((item: { id: string }) => item.id === assessment.id).attempts[0].score).toBeNull();
    const hiddenResult = await request(app).get(`/api/learning/student/attempts/${attempt.id}`).set('Cookie', studentCookie);
    expect(hiddenResult.body.data.attempt.history[0].score).toBeNull();
    expect((await request(app).get(`/api/learning/student/attempts/${attempt.id}/result`).set('Cookie', studentCookie)).status).toBe(403);
    expect((await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/results/release`).set('Cookie', instructorCookie)).status).toBe(200);
    const result = await request(app).get(`/api/learning/student/attempts/${attempt.id}/result`).set('Cookie', studentCookie);
    expect(result.status).toBe(200);
    expect(result.body.data.result.questions[0]).toHaveProperty('correctAnswer');
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'ASSESSMENT_RESULTS_RELEASED', targetId: assessment.id } })).toBe(1);
  });

  it('grades multiple choice, true/false, and trimmed case-insensitive short answers server-side', async () => {
    const assessment = await createAssessment(adminCookie, {
      questionSet: [
        question({ type: 'MCQ_MULTIPLE', options: ['A', 'B', 'C'], correctAnswer: ['B', 'C'], marks: 2 }),
        question({ type: 'TRUE_FALSE', options: ['True', 'False'], correctAnswer: 'True', marks: 1 }),
        question({ type: 'SHORT_ANSWER', options: null, correctAnswer: ['Jishnu', 'JLL'], marks: 1 }),
      ],
    });
    await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', adminCookie);
    const started = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    const attempt = started.body.data.attempt as { id: string; questions: Array<Record<string, unknown>> };
    const answers = [['B', 'C'], 'true', '  jIsHnU  '];
    for (const [index, answer] of answers.entries()) {
      await request(app).put(`/api/learning/student/attempts/${attempt.id}/answers`).set('Cookie', studentCookie).send({
        questionId: attempt.questions[index]!.id, answer,
      });
    }
    const submitted = await request(app).post(`/api/learning/student/attempts/${attempt.id}/submit`).set('Cookie', studentCookie);
    expect(submitted.body.data.attempt.score).toBe(4);
  });
});

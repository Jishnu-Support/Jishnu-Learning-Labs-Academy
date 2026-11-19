import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus, AssessmentAttemptStatus, CourseStatus, EnrollmentStatus, OrganizationStatus,
  PrismaClient, Role, StudentStatus,
} from '@prisma/client';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();
const password = 'LearningTest!1234';
const prefix = `l-${Date.now()}`;
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
      ...(role === Role.TUTOR ? { tutorProfile: { create: { organizationId, tutorId: `${prefix}-${name}` } } } : {}),
    },
  });
}

function cookie(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : values ? [values] : []).map((value) => value.split(';')[0]).join('; ');
}

async function login(role: 'org-admin' | 'tutors' | 'students' | 'tutor', code: string, user: Awaited<ReturnType<typeof makeUser>>) {
  const isTutor = role === 'tutors' || role === 'tutor';
  const path = role === 'org-admin'
    ? '/api/auth/org-admin/login'
    : isTutor
      ? '/api/auth/tutors/login'
      : `/api/auth/${role}/login`;
  const identifier = role === 'tutor'
    ? (await prisma.tutorProfile.findUniqueOrThrow({ where: { userId: user.id }, select: { tutorId: true } })).tutorId
    : user.email;
  const payload = role === 'students'
    ? { organizationCode: code, studentId: `${prefix}-${user.name}`, password }
    : isTutor
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
let secondTutorStudent: Awaited<ReturnType<typeof makeUser>>;
let tutor: Awaited<ReturnType<typeof makeUser>>;
let secondInstructor: Awaited<ReturnType<typeof makeUser>>;
let courseId: string;
let otherCourseId: string;
let adminCookie = '';
let instructorCookie = '';
let studentCookie = '';
let otherStudentCookie = '';
let tutorCookie = '';
let secondInstructorCookie = '';

beforeAll(async () => {
  await prisma.$connect();
  organization = await makeOrganization('primary');
  otherOrganization = await makeOrganization('other');
  admin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
  instructor = await makeUser(organization.id, Role.TUTOR, 'assigned-tutor');
  secondInstructor = await makeUser(organization.id, Role.TUTOR, 'second-assigned-tutor');
  unassignedInstructor = await makeUser(organization.id, Role.TUTOR, 'unassigned-tutor');
  student = await makeUser(organization.id, Role.STUDENT, 'student');
  secondTutorStudent = await makeUser(organization.id, Role.STUDENT, 'second-tutor-student');
  otherStudent = await makeUser(otherOrganization.id, Role.STUDENT, 'other-student');
  tutor = await makeUser(organization.id, Role.TUTOR, 'practice-tutor');
  const course = await prisma.course.create({
    data: {
      organizationId: organization.id, code: `${prefix}-COURSE`, title: 'Learning test course',
      category: 'Test', plannedHours: 4, startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2027-01-01T00:00:00.000Z'), status: CourseStatus.PUBLISHED,
      createdById: admin.id,
    },
  });
  courseId = course.id;
  const otherCourse = await prisma.course.create({
    data: {
      organizationId: otherOrganization.id, code: `${prefix}-OTHER-COURSE`, title: 'Other student course',
      category: 'Test', plannedHours: 4, startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2027-01-01T00:00:00.000Z'), status: CourseStatus.PUBLISHED,
      createdById: otherStudent.id,
    },
  });
  otherCourseId = otherCourse.id;
  await prisma.courseInstructor.createMany({ data: [
    { organizationId: organization.id, courseId, instructorId: instructor.id },
    { organizationId: organization.id, courseId, instructorId: secondInstructor.id },
  ] });
  await prisma.enrollment.create({ data: { organizationId: organization.id, courseId, studentId: student.id, selectedTutorId: instructor.id, status: EnrollmentStatus.ACTIVE } });
  await prisma.enrollment.create({ data: { organizationId: organization.id, courseId, studentId: secondTutorStudent.id, selectedTutorId: secondInstructor.id, status: EnrollmentStatus.ACTIVE } });
  await prisma.enrollment.create({ data: { organizationId: otherOrganization.id, courseId: otherCourseId, studentId: otherStudent.id, status: EnrollmentStatus.ACTIVE } });
  adminCookie = await login('org-admin', organization.code!, admin);
  instructorCookie = await login('tutors', organization.code!, instructor);
  secondInstructorCookie = await login('tutors', organization.code!, secondInstructor);
  studentCookie = await login('students', organization.code!, student);
  otherStudentCookie = await login('students', otherOrganization.code!, otherStudent);
  tutorCookie = await login('tutor', organization.code!, tutor);
});

afterAll(async () => {
  if (organizationIds.length) {
    await prisma.expertSession.deleteMany({ where: { organizationId: { in: organizationIds } } });
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
  it('limits Tutor visibility to accepted students and the Tutor’s own profile', async () => {
    const listedStudents = await request(app).get('/api/students').set('Cookie', instructorCookie);
    expect(listedStudents.status).toBe(200);
    expect(listedStudents.body.data.students.map((item: { studentId: string }) => item.studentId)).toEqual([`${prefix}-student`]);
    expect((await request(app).get(`/api/students/${prefix}-second-tutor-student`).set('Cookie', instructorCookie)).status).toBe(404);
    expect((await request(app).get(`/api/students/${prefix}-second-tutor-student`).set('Cookie', secondInstructorCookie)).status).toBe(200);

    const enrollments = await request(app).get(`/api/courses/${courseId}/enrollments`).set('Cookie', instructorCookie);
    expect(enrollments.status).toBe(200);
    expect(enrollments.body.data.enrollments.map((item: { student: { name: string } }) => item.student.name)).toEqual([student.name]);
    const course = await request(app).get(`/api/courses/${courseId}`).set('Cookie', instructorCookie);
    expect(course.body.data.course.instructors).toEqual([{ instructor: { id: instructor.id, name: instructor.name } }]);

    const tutorDirectory = await request(app).get('/api/tutors?page=1&pageSize=100').set('Cookie', instructorCookie);
    expect(tutorDirectory.status).toBe(403);
    expect((await request(app).get(`/api/tutors/${instructor.id}`).set('Cookie', instructorCookie)).status).toBe(403);
    expect((await request(app).get(`/api/tutors/${secondInstructor.id}`).set('Cookie', instructorCookie)).status).toBe(403);
    expect((await request(app).get(`/api/tutors/${secondInstructor.id}/photo`).set('Cookie', instructorCookie)).status).toBe(403);

    const assessment = await createAssessment(instructorCookie);
    await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', instructorCookie).expect(200);
    const submittedAt = new Date();
    await prisma.assessmentAttempt.createMany({
      data: [student, secondTutorStudent].map((candidate) => ({
        organizationId: organization.id,
        assessmentId: assessment.id,
        studentId: candidate.id,
        status: AssessmentAttemptStatus.SUBMITTED,
        snapshot: [],
        expiresAt: new Date(submittedAt.getTime() + 30 * 60_000),
        submittedAt,
        score: 1,
        percentage: 50,
      })),
    });
    const results = await request(app).get(`/api/learning/teacher/assessments/${assessment.id}/results`).set('Cookie', instructorCookie);
    expect(results.status).toBe(200);
    expect(results.body.data.attempts.map((item: { studentId: string }) => item.studentId)).toEqual([student.id]);
    const reports = await request(app).get(`/api/learning/reports?courseId=${courseId}&pageSize=100`).set('Cookie', instructorCookie);
    expect(reports.status).toBe(200);
    expect(reports.body.data.rows.map((item: { studentId: string }) => item.studentId)).toEqual([`${prefix}-student`]);
  });

  it('limits Tutor session attendance to students who selected that Tutor', async () => {
    const scheduled = await request(app).post('/api/portal/manage/sessions').set('Cookie', instructorCookie).send({
      courseId,
      title: 'Tutor scope test session',
      description: '',
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationMinutes: 45,
      freePreview: false,
    });
    expect(scheduled.status).toBe(201);
    const sessionId = scheduled.body.data.session.id as string;
    const attendees = await request(app).get(`/api/portal/manage/sessions/${sessionId}/attendees`).set('Cookie', instructorCookie);
    expect(attendees.status).toBe(200);
    expect(attendees.body.data.attendees.map((item: { student: { id: string } }) => item.student.id)).toEqual([student.id]);
    expect((await request(app).put(`/api/portal/manage/sessions/${sessionId}/attendance/${secondTutorStudent.id}`)
      .set('Cookie', instructorCookie).send({ status: 'PRESENT' })).status).toBe(404);
  });

  it('uses the configured Azure OpenAI endpoint and validates generated questions before returning them', async () => {
    const prior = {
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      key: env.AZURE_OPENAI_API_KEY,
      deployment: env.AZURE_OPENAI_DEPLOYMENT,
    };
    const generated = {
      questions: [{
        prompt: 'What is one half of 8?',
        options: ['2', '4', '6', '8'],
        correctAnswer: '4',
        explanation: '8 divided by 2 is 4.',
        topic: 'Fractions',
        difficulty: 'INTERMEDIATE',
        marks: 2,
      }],
    };
    const mockFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('/openai/deployments/test-deployment/chat/completions');
      expect(new Headers(init?.headers).get('api-key')).toBe('test-only-key');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      env.AZURE_OPENAI_ENDPOINT = 'https://azure-openai.example.test';
      env.AZURE_OPENAI_API_KEY = 'test-only-key';
      env.AZURE_OPENAI_DEPLOYMENT = 'test-deployment';
      vi.stubGlobal('fetch', mockFetch);
      const response = await request(app).post('/api/learning/teacher/assessments/generate-questions')
        .set('Cookie', instructorCookie)
        .send({ courseId, topic: 'Fractions', count: 1, difficulty: 'INTERMEDIATE', marksPerQuestion: 2 });
      expect(response.status).toBe(200);
      expect(response.body.data.questions).toEqual(generated.questions);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/openai/deployments/test-deployment/chat/completions');
      expect((mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>)['api-key']).toBe('test-only-key');
      expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'ASSESSMENT_QUESTIONS_AI_GENERATED' } })).toBe(1);
    } finally {
      env.AZURE_OPENAI_ENDPOINT = prior.endpoint;
      env.AZURE_OPENAI_API_KEY = prior.key;
      env.AZURE_OPENAI_DEPLOYMENT = prior.deployment;
      vi.unstubAllGlobals();
    }
  });

  it('limits teacher question management by role and assigned course', async () => {
    const created = await request(app).post('/api/learning/teacher/questions').set('Cookie', instructorCookie).send(question());
    expect(created.status).toBe(201);
    expect((await request(app).get('/api/learning/teacher/questions').set('Cookie', studentCookie)).status).toBe(403);
    const unassignedQuestions = await request(app).get('/api/learning/teacher/questions').set('Cookie', tutorCookie);
    expect(unassignedQuestions.status).toBe(200);
    expect(unassignedQuestions.body.data.questions).toHaveLength(0);

    const otherCourse = await prisma.course.create({
      data: {
        organizationId: organization.id, code: `${prefix}-UNASSIGNED`, title: 'Unassigned course',
        category: 'Test', plannedHours: 1, startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'), status: CourseStatus.PUBLISHED, createdById: admin.id,
      },
    });
    const forbidden = await request(app).post('/api/learning/teacher/questions').set('Cookie', await login('tutors', organization.code!, unassignedInstructor)).send(question({ courseId: otherCourse.id }));
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

  it('creates tenant-scoped Practice Sets and serves published sets through student practice sessions', async () => {
    const savedQuestion = await request(app).post('/api/learning/teacher/questions').set('Cookie', instructorCookie).send(question());
    expect(savedQuestion.status).toBe(201);
    const questionId = savedQuestion.body.data.question.id as string;
    const created = await request(app).post('/api/learning/teacher/practice-sets').set('Cookie', instructorCookie).send({
      courseId, title: `${prefix} fundamentals`, topic: 'Fundamentals', difficulty: 'BEGINNER', questionIds: [questionId],
    });
    expect(created.status).toBe(201);
    const setId = created.body.data.practiceSet.id as string;
    expect((await request(app).get('/api/learning/teacher/practice-sets').set('Cookie', tutorCookie)).body.data.practiceSets).toHaveLength(0);
    expect((await request(app).get(`/api/learning/teacher/practice-sets/${setId}`).set('Cookie', instructorCookie)).body.data.practiceSet.questions[0].correctAnswer).toBe('A');
    expect((await request(app).get('/api/learning/student/practice-sets').set('Cookie', studentCookie)).body.data.practiceSets).toHaveLength(0);

    await request(app).patch(`/api/learning/teacher/practice-sets/${setId}`).set('Cookie', instructorCookie).send({ published: true }).expect(200);
    const studentSets = await request(app).get('/api/learning/student/practice-sets').set('Cookie', studentCookie);
    expect(studentSets.status).toBe(200);
    expect(studentSets.body.data.practiceSets).toEqual([
      expect.objectContaining({ id: setId, title: `${prefix} fundamentals`, questionCount: 1 }),
    ]);
    expect(studentSets.body.data.practiceSets[0]).not.toHaveProperty('questionIds');
    expect((await request(app).get(`/api/learning/student/practice-sets?courseId=${otherCourseId}`).set('Cookie', studentCookie)).status).toBe(404);
    expect((await request(app).get(`/api/learning/student/practice/history?courseId=${otherCourseId}`).set('Cookie', studentCookie)).status).toBe(404);

    const started = await request(app).post(`/api/learning/student/practice-sets/${setId}/start`).set('Cookie', studentCookie);
    expect(started.status).toBe(201);
    expect(started.body.data.question).not.toHaveProperty('correctAnswer');
    const sessionId = started.body.data.session.id as string;
    await request(app).post(`/api/learning/student/practice-sessions/${sessionId}/answers`).set('Cookie', studentCookie).send({
      questionId, answer: 'A',
    }).expect(200);
    const history = await request(app).get('/api/learning/student/practice/history').set('Cookie', studentCookie);
    expect(history.body.data.sessions[0].practiceSet.title).toBe(`${prefix} fundamentals`);
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, targetId: setId, action: 'PRACTICE_SET_CREATED' } })).toBe(1);
  });

  it('publishes immutable snapshots, grades on the server, and enforces attempt limits', async () => {
    const assessment = await createAssessment(instructorCookie);
    expect((await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', instructorCookie)).status).toBe(200);
    const courseAssessments = await request(app).get(`/api/learning/student/assessments?courseId=${courseId}`).set('Cookie', studentCookie);
    expect(courseAssessments.body.data.assessments.map((item: { id: string }) => item.id)).toContain(assessment.id);
    expect((await request(app).get(`/api/learning/student/assessments?courseId=${otherCourseId}`).set('Cookie', studentCookie)).status).toBe(404);
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

  it('closes and reopens assessments, lets running attempts finish, previews without attempts, and duplicates all questions', async () => {
    const assessment = await createAssessment(instructorCookie, {
      maxAttempts: 3,
      questionSet: [
        question({ prompt: 'First preview question', marks: 1 }),
        question({ prompt: 'Second preview question', type: 'TRUE_FALSE', options: ['True', 'False'], correctAnswer: 'True', marks: 1 }),
      ],
    });
    const adminAssessment = await createAssessment(adminCookie);
    const tutorAssessments = await request(app).get('/api/learning/teacher/assessments').set('Cookie', instructorCookie);
    expect(tutorAssessments.body.data.assessments.map((item: { id: string }) => item.id)).toContain(assessment.id);
    expect(tutorAssessments.body.data.assessments.map((item: { id: string }) => item.id)).not.toContain(adminAssessment.id);
    expect((await request(app).get(`/api/learning/teacher/assessments/${adminAssessment.id}`).set('Cookie', instructorCookie)).status).toBe(404);

    await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', instructorCookie).expect(200);
    const attemptsBeforePreview = await prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id } });
    const preview = await request(app).get(`/api/learning/teacher/assessments/${assessment.id}`).set('Cookie', instructorCookie);
    expect(preview.status).toBe(200);
    expect(preview.body.data.assessment.questions).toHaveLength(2);
    expect(await prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id } })).toBe(attemptsBeforePreview);

    const running = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    expect(running.status).toBe(201);
    const attemptId = running.body.data.attempt.id as string;
    const questionId = running.body.data.attempt.questions[0].id as string;
    const closed = await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/close`).set('Cookie', instructorCookie);
    expect(closed.status).toBe(200);
    expect(closed.body.data.assessment.status).toBe('CLOSED');
    expect((await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie)).status).toBe(404);
    expect((await request(app).put(`/api/learning/student/attempts/${attemptId}/answers`).set('Cookie', studentCookie).send({ questionId, answer: 'A' })).status).toBe(200);
    expect((await request(app).post(`/api/learning/student/attempts/${attemptId}/submit`).set('Cookie', studentCookie)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, targetId: assessment.id, action: 'ASSESSMENT_CLOSED' } })).toBe(1);

    const reopened = await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/reopen`).set('Cookie', instructorCookie);
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.assessment.status).toBe('PUBLISHED');
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, targetId: assessment.id, action: 'ASSESSMENT_REOPENED' } })).toBe(1);
    const reopenedAttempt = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    expect(reopenedAttempt.status).toBe(201);
    const reopenedAttemptId = reopenedAttempt.body.data.attempt.id as string;
    await request(app).post(`/api/learning/student/attempts/${reopenedAttemptId}/submit`).set('Cookie', studentCookie).expect(200);

    const duplicate = await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/duplicate`).set('Cookie', instructorCookie);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.assessment).toMatchObject({ status: 'DRAFT', title: expect.stringMatching(/\(Copy\)$/) });
    expect(duplicate.body.data.assessment.questions.map((item: { prompt: string }) => item.prompt)).toEqual([
      'First preview question',
      'Second preview question',
    ]);
  });

  it('scopes assessment reports, filters outcomes, exposes attempt history, and exports CSV', async () => {
    const assessment = await createAssessment(instructorCookie);
    await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/publish`).set('Cookie', instructorCookie).expect(200);
    const started = await request(app).post(`/api/learning/student/assessments/${assessment.id}/attempts`).set('Cookie', studentCookie);
    expect(started.status).toBe(201);
    const attempt = started.body.data.attempt as { id: string; questions: Array<{ id: string }> };
    await request(app).put(`/api/learning/student/attempts/${attempt.id}/answers`).set('Cookie', studentCookie).send({
      questionId: attempt.questions[0]!.id, answer: 'A',
    }).expect(200);
    await request(app).post(`/api/learning/student/attempts/${attempt.id}/submit`).set('Cookie', studentCookie).expect(200);

    const reports = await request(app).get(`/api/learning/reports?status=COMPLETED&level=BEGINNER&assessmentId=${assessment.id}`).set('Cookie', instructorCookie);
    expect(reports.status).toBe(200);
    expect(reports.body.data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentName: student.name, studentId: `${prefix}-student`, assessmentId: assessment.id,
        status: 'COMPLETED', attempts: 1, bestScore: 2, totalMarks: 2, grade: 'A', passed: true,
      }),
    ]));
    expect(reports.body.data.summary).toMatchObject({ enrolled: 1, completed: 1, passed: 1, failed: 0 });

    const studentHistory = await request(app).get(`/api/learning/reports/students/${prefix}-student?assessmentId=${assessment.id}`).set('Cookie', instructorCookie);
    expect(studentHistory.status).toBe(200);
    expect(studentHistory.body.data.attempts).toHaveLength(1);
    expect(studentHistory.body.data.attempts[0]).not.toHaveProperty('answers');
    expect((await request(app).get('/api/learning/reports').set('Cookie', studentCookie)).status).toBe(403);

    const csv = await request(app).get('/api/learning/reports/export.csv?status=COMPLETED').set('Cookie', instructorCookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('"Student name","Student ID"');
    expect(csv.text).toContain(`${prefix}-student`);
    expect((await request(app).get('/api/learning/reports?dateFrom=invalid').set('Cookie', instructorCookie)).status).toBe(400);
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
    expect((await request(app).post(`/api/learning/teacher/assessments/${assessment.id}/results/release`).set('Cookie', adminCookie)).status).toBe(200);
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

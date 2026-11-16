import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, PrismaClient, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';
import { localDiskStorage } from '../src/modules/notes/storage.service.js';
import { createSamplePdf } from '../prisma/library-sample.js';

const prisma = new PrismaClient();
const password = 'TestPass!1234';
const newPassword = 'ChangedPass!5678';
const prefix = `phase1b-${Date.now()}`;
const organizationIds: string[] = [];

async function makeOrganization(suffix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`,
      code: `${prefix}-${suffix.toLowerCase()}`,
      headName: 'Test Organization Head',
      contactNumber: '+15555550100',
      email: `${prefix}-${suffix.toLowerCase()}@example.test`,
      address: '10 Test Street',
      city: 'Test City',
      state: 'Test State',
      country: 'Test Country',
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
  options: { status?: AccountStatus; identifier?: string; mustChangePassword?: boolean } = {},
) {
  const status = options.status ?? AccountStatus.APPROVED;
  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name: `${suffix} Person`,
      phone: '+15555550123',
      role,
      status,
      mustChangePassword: options.mustChangePassword ?? false,
      ...(role === Role.STUDENT ? {
        studentProfile: {
          create: {
            organizationId,
            studentId: options.identifier ?? `${prefix}-${suffix}`,
            status: status as StudentStatus,
          },
        },
      } : {}),
      ...(role === Role.TUTOR ? {
        tutorProfile: {
          create: {
            organizationId,
            tutorId: options.identifier ?? `${prefix}-${suffix}`,
            joiningDate: new Date('2026-03-01T00:00:00.000Z'),
          },
        },
      } : {}),
    },
  });
  return user;
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function login(role: 'org-admin' | 'tutors' | 'tutor' | 'students', organizationCode: string, identifier: string, secret = password) {
  const isTutor = role === 'tutors' || role === 'tutor';
  const endpoint = role === 'org-admin'
    ? '/api/auth/org-admin/login'
    : isTutor
      ? '/api/auth/tutors/login'
      : `/api/auth/${role}/login`;
  const body = role === 'students'
    ? { organizationCode, studentId: identifier, password: secret }
    : isTutor
      ? { organizationCode, identifier, password: secret }
      : { organizationCode, email: identifier, password: secret };
  return request(app).post(endpoint).send(body);
}

async function createNote(cookie: string, input: { title: string; published?: boolean; filename?: string; mimeType?: string }) {
  const pendingRequest = request(app)
    .post('/api/notes')
    .set('Cookie', cookie)
    .field('title', input.title)
    .field('subject', 'Testing')
    .field('description', `Description for ${input.title}`);
  if (input.filename) {
    pendingRequest.attach('file', Buffer.from('phase 1b test file'), {
      filename: input.filename,
      contentType: input.mimeType ?? 'image/png',
    });
  }
  const created = await pendingRequest;
  if (created.body.data?.note?.id) {
    if (input.published) {
      const publish = await request(app).post(`/api/notes/${created.body.data.note.id}/publish`).set('Cookie', cookie);
      expect(publish.status).toBe(200);
      created.body.data.note.published = true;
    }
  }
  return created;
}

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  if (organizationIds.length) {
    const storedNotes = await prisma.note.findMany({
      where: { organizationId: { in: organizationIds }, storageKey: { not: null } },
      select: { storageKey: true },
    });
    const storedLibraryFiles = await prisma.libraryItem.findMany({
      where: { organizationId: { in: organizationIds }, storageKey: { not: null } },
      select: { storageKey: true },
    });
    for (const note of storedNotes) {
      if (note.storageKey) await localDiskStorage.remove(note.storageKey);
    }
    for (const item of storedLibraryFiles) {
      if (item.storageKey) await localDiskStorage.remove(item.storageKey);
    }
    await prisma.noteView.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.note.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.certificate.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.gameRating.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.attendanceRecord.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.savedLibraryItem.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.libraryItem.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.expertSession.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.studentProfile.updateMany({
      where: { organizationId: { in: organizationIds } },
      data: { selectedTutorId: null },
    });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.$disconnect();
});

describe('Checkpoint 1B tutor and student directories', () => {
  it('creates tutor with a one-time temporary password and enforces password change', async () => {
    const organization = await makeOrganization('tutor');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'tutor-admin');
    const adminLogin = await login('org-admin', organization.code!, admin.email);
    const adminCookie = cookieHeader(adminLogin);
    const temporaryPassword = 'OneTimeTutorPass!9';
    const created = await request(app).post('/api/tutors').set('Cookie', adminCookie).send({
      tutorId: 'TUT-NEW-1',
      name: 'New Tutor',
      phone: '+15555550124',
      email: `${prefix}-new-tutor@example.test`,
      joiningDate: '2026-06-15',
      temporaryPassword,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.tutor.user.status).toBe(AccountStatus.APPROVED);
    expect(created.body.data.tutor.user.mustChangePassword).toBeUndefined();
    expect(created.body.data.temporaryPassword).toBe(temporaryPassword);
    const createdUser = await prisma.user.findFirstOrThrow({ where: { organizationId: organization.id, email: `${prefix}-new-tutor@example.test` } });
    expect(createdUser.mustChangePassword).toBe(true);
    const duplicateTutorId = await request(app).post('/api/tutors').set('Cookie', adminCookie).send({
      tutorId: 'TUT-NEW-1',
      name: 'Duplicate Tutor ID',
      phone: '+15555550125',
      email: `${prefix}-duplicate-tutor@example.test`,
      joiningDate: '2026-06-15',
      temporaryPassword,
    });
    expect(duplicateTutorId.status).toBe(409);

    const tutorLogin = await login('tutor', organization.code!, 'TUT-NEW-1', temporaryPassword);
    expect(tutorLogin.status).toBe(200);
    expect(tutorLogin.body.data.user.mustChangePassword).toBe(true);
    const tutorCookie = cookieHeader(tutorLogin);
    expect((await request(app).get('/api/students').set('Cookie', tutorCookie)).status).toBe(403);
    const changed = await request(app).post('/api/auth/change-password').set('Cookie', tutorCookie).send({
      currentPassword: temporaryPassword,
      newPassword,
    });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/students').set('Cookie', tutorCookie)).status).toBe(200);
    expect((await login('tutor', organization.code!, 'TUT-NEW-1', temporaryPassword)).status).toBe(401);
    expect((await login('tutor', organization.code!, 'TUT-NEW-1', newPassword)).status).toBe(200);

    const tutorList = await request(app).get('/api/tutors?search=TUT-NEW-1').set('Cookie', adminCookie);
    expect(tutorList.status).toBe(200);
    expect(tutorList.body.data.tutors).toHaveLength(1);
    expect(JSON.stringify(tutorList.body)).not.toContain('passwordHash');
    expect(JSON.stringify(tutorList.body)).not.toContain(temporaryPassword);
    const creationAuditCount = await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'TUTOR_CREATED' } });
    expect(creationAuditCount).toBe(1);
    expect((await request(app).post(`/api/tutors/${createdUser.id}/suspend`).set('Cookie', adminCookie)).status).toBe(200);
    expect((await login('tutor', organization.code!, 'TUT-NEW-1', newPassword)).status).toBe(403);
    expect((await request(app).post(`/api/tutors/${createdUser.id}/reactivate`).set('Cookie', adminCookie)).status).toBe(200);
    const activeTutorCookie = cookieHeader(await login('tutor', organization.code!, 'TUT-NEW-1', newPassword));
    expect((await request(app).post('/api/tutors').set('Cookie', activeTutorCookie).send({})).status).toBe(403);
  }, 30000);

  it('scopes student and tutor search and detail data to the caller organization', async () => {
    const first = await makeOrganization('directory-a');
    const second = await makeOrganization('directory-b');
    const adminA = await makeUser(first.id, Role.ORG_ADMIN, 'directory-admin-a');
    const instructorB = await makeUser(second.id, Role.TUTOR, 'directory-unassigned-tutor-b');
    const tutorA = await makeUser(first.id, Role.TUTOR, 'directory-tutor-a', { identifier: 'TUT-SEARCH-1' });
    const tutorB = await makeUser(second.id, Role.TUTOR, 'directory-tutor-b', { identifier: 'TUT-SEARCH-1' });
    const studentA = await makeUser(first.id, Role.STUDENT, 'directory-student-a', { identifier: 'STUDENT-SEARCH-1' });
    const studentB = await makeUser(second.id, Role.STUDENT, 'directory-student-b', { identifier: 'STUDENT-SEARCH-1' });
    await makeUser(second.id, Role.STUDENT, 'directory-student-b-other', { identifier: 'OTHER-STU-1' });
    const adminLogin = await login('org-admin', first.code!, adminA.email);
    const instructorLogin = await login('tutors', second.code!, instructorB.email);
    const tutorLogin = await login('tutor', first.code!, 'TUT-SEARCH-1');
    const adminCookie = cookieHeader(adminLogin);
    const instructorCookie = cookieHeader(instructorLogin);
    const tutorCookie = cookieHeader(tutorLogin);

    const students = await request(app).get('/api/students?search=STUDENT-SEARCH-1').set('Cookie', adminCookie);
    expect(students.status).toBe(200);
    expect(students.body.data.students.map((student: { user: { id: string } }) => student.user.id)).toEqual([studentA.id]);
    const otherStudents = await request(app).get('/api/students?search=STUDENT-SEARCH-1').set('Cookie', instructorCookie);
    expect(otherStudents.body.data.students.map((student: { user: { id: string } }) => student.user.id)).toEqual([studentB.id]);
    const otherStudentDetail = await request(app).get('/api/students/STUDENT-SEARCH-1').set('Cookie', adminCookie);
    expect(otherStudentDetail.status).toBe(200);
    const crossStudent = await request(app).get('/api/students/OTHER-STU-1').set('Cookie', adminCookie);
    expect(crossStudent.status).toBe(404);

    const tutorSearch = await request(app).get('/api/tutors?search=TUT-SEARCH-1').set('Cookie', adminCookie);
    expect(tutorSearch.status).toBe(200);
    expect(tutorSearch.body.data.tutors.map((member: { user: { id: string } }) => member.user.id)).toEqual([tutorA.id]);
    const crossTutor = await request(app).get(`/api/tutors/${tutorB.id}`).set('Cookie', adminCookie);
    expect(crossTutor.status).toBe(404);
    expect((await request(app).post(`/api/tutors/${tutorA.id}/suspend`).set('Cookie', tutorCookie)).status).toBe(403);
    const studentCookie = cookieHeader(await login('students', first.code!, 'STUDENT-SEARCH-1'));
    expect((await request(app).get('/api/students').set('Cookie', studentCookie)).status).toBe(403);
    expect((await request(app).get('/api/tutors').set('Cookie', studentCookie)).status).toBe(403);
  });

  it('returns safe student profile login summaries and audits suspension actions', async () => {
    const organization = await makeOrganization('student-details');
    const instructor = await makeUser(organization.id, Role.TUTOR, 'student-details-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'student-details-student', { identifier: 'DETAIL-STU-1' });
    await prisma.loginLog.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        organizationId: organization.id,
        userId: student.id,
        success: true,
        createdAt: new Date(Date.now() - index * 1000),
      })),
    });
    const instructorLogin = await login('tutors', organization.code!, instructor.email);
    const cookie = cookieHeader(instructorLogin);
    const detail = await request(app).get('/api/students/DETAIL-STU-1').set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.student.loginHistory.recentLogins).toHaveLength(10);
    expect(detail.body.data.student.loginHistory.lastLoginAt).toBeTruthy();
    expect(JSON.stringify(detail.body)).not.toContain('passwordHash');
    expect(JSON.stringify(detail.body)).not.toContain('refreshToken');
    expect((await request(app).post('/api/students/DETAIL-STU-1/suspend').set('Cookie', cookie)).status).toBe(200);
    const studentProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    const suspensionAuditCount = await prisma.auditLog.count({
      where: { organizationId: organization.id, action: 'STUDENT_SUSPENDED', targetId: studentProfile.id },
    });
    expect(suspensionAuditCount).toBe(1);
    expect((await request(app).post('/api/students/DETAIL-STU-1/reactivate').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('Checkpoint 1B protected notes', () => {
  it('enforces authorship, role access, published-only student view, and inline view auditing', async () => {
    const first = await makeOrganization('notes-a');
    const second = await makeOrganization('notes-b');
    const admin = await makeUser(first.id, Role.ORG_ADMIN, 'notes-admin');
    const instructor = await makeUser(first.id, Role.TUTOR, 'notes-author-tutor');
    await makeUser(first.id, Role.TUTOR, 'notes-tutor');
    const student = await makeUser(first.id, Role.STUDENT, 'notes-student', { identifier: 'NOTE-STUDENT-1' });
    const otherAdmin = await makeUser(second.id, Role.ORG_ADMIN, 'notes-other-admin');
    const adminCookie = cookieHeader(await login('org-admin', first.code!, admin.email));
    const instructorCookie = cookieHeader(await login('tutors', first.code!, instructor.email));
    const tutorCookie = cookieHeader(await login('tutor', first.code!, `${prefix}-notes-tutor@example.test`));
    const studentCookie = cookieHeader(await login('students', first.code!, 'NOTE-STUDENT-1'));
    const otherCookie = cookieHeader(await login('org-admin', second.code!, otherAdmin.email));

    const tutorNote = await createNote(tutorCookie, { title: 'Tutor published image', published: true, filename: 'tutor.png' });
    const instructorNote = await createNote(instructorCookie, { title: 'Tutor draft' });
    const adminNote = await createNote(adminCookie, { title: 'Admin draft' });
    const otherNote = await createNote(otherCookie, { title: 'Other organization published', published: true, filename: 'other.png' });
    expect(tutorNote.status).toBe(201);
    expect(instructorNote.status).toBe(201);
    expect(adminNote.status).toBe(201);
    expect(otherNote.status).toBe(201);
    const tutorNoteId = tutorNote.body.data.note.id as string;
    const instructorNoteId = instructorNote.body.data.note.id as string;
    const adminNoteId = adminNote.body.data.note.id as string;
    const otherNoteId = otherNote.body.data.note.id as string;

    expect((await request(app).patch(`/api/notes/${instructorNoteId}`).set('Cookie', tutorCookie).send({ title: 'not owner' })).status).toBe(403);
    expect((await request(app).delete(`/api/notes/${instructorNoteId}`).set('Cookie', tutorCookie)).status).toBe(403);
    expect((await request(app).patch(`/api/notes/${tutorNoteId}`).set('Cookie', tutorCookie).send({ title: 'Tutor edited own note' })).status).toBe(200);
    expect((await request(app).patch(`/api/notes/${tutorNoteId}`).set('Cookie', adminCookie).send({ title: 'Admin edited any note' })).status).toBe(200);
    expect((await request(app).post(`/api/notes/${instructorNoteId}/publish`).set('Cookie', instructorCookie)).status).toBe(200);

    const studentList = await request(app).get('/api/notes').set('Cookie', studentCookie);
    expect(studentList.status).toBe(200);
    expect(studentList.body.data.notes).toHaveLength(0);
    const browseAll = await request(app).get('/api/notes?saved=all').set('Cookie', studentCookie);
    expect(browseAll.body.data.notes.map((note: { id: string }) => note.id)).toContain(tutorNoteId);
    expect(browseAll.body.data.notes.map((note: { id: string }) => note.id)).not.toContain(adminNoteId);
    expect(JSON.stringify(studentList.body)).not.toContain('/api/notes/');
    expect((await request(app).get(`/api/notes/${adminNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);
    expect((await request(app).get(`/api/notes/${otherNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);

    const studentView = await request(app).get(`/api/notes/${tutorNoteId}/view`).set('Cookie', studentCookie);
    expect(studentView.status).toBe(200);
    expect(studentView.headers['cache-control']).toBe('no-store');
    expect(studentView.headers['content-disposition']).toContain('inline');
    expect(studentView.headers['x-content-type-options']).toBe('nosniff');
    expect(studentView.body.toString()).toBe('phase 1b test file');
    expect(await prisma.noteView.count({ where: { organizationId: first.id, noteId: tutorNoteId, userId: student.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: first.id, action: 'NOTE_VIEWED', targetId: tutorNoteId, actorId: student.id } })).toBe(1);

    const deniedStudentMutations = await Promise.all([
      request(app).post('/api/notes').set('Cookie', studentCookie).send({ title: 'Forbidden', subject: 'Test', description: 'No' }),
      request(app).patch(`/api/notes/${tutorNoteId}`).set('Cookie', studentCookie).send({ title: 'Forbidden' }),
      request(app).delete(`/api/notes/${tutorNoteId}`).set('Cookie', studentCookie),
      request(app).post(`/api/notes/${tutorNoteId}/publish`).set('Cookie', studentCookie),
      request(app).post(`/api/notes/${tutorNoteId}/unpublish`).set('Cookie', studentCookie),
      request(app).get(`/api/notes/${tutorNoteId}/download`).set('Cookie', studentCookie),
    ]);
    expect(deniedStudentMutations.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect((await request(app).get(`/api/notes/${otherNoteId}/download`).set('Cookie', tutorCookie)).status).toBe(404);
    expect((await request(app).get(`/api/notes/${tutorNoteId}/download`).set('Cookie', tutorCookie)).headers['content-disposition']).toContain('attachment');

    expect((await request(app).post(`/api/notes/${tutorNoteId}/unpublish`).set('Cookie', tutorCookie)).status).toBe(200);
    expect((await request(app).post(`/api/notes/${tutorNoteId}/publish`).set('Cookie', tutorCookie)).status).toBe(200);
    expect((await request(app).delete(`/api/notes/${tutorNoteId}`).set('Cookie', tutorCookie)).status).toBe(204);
    expect((await request(app).get(`/api/notes/${tutorNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);
    expect((await request(app).delete(`/api/notes/${instructorNoteId}`).set('Cookie', instructorCookie)).status).toBe(204);
    expect((await request(app).get(`/api/notes/${instructorNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { organizationId: first.id, action: { in: ['NOTE_CREATED', 'NOTE_UPDATED', 'NOTE_PUBLISHED', 'NOTE_DELETED'] } } })).toBeGreaterThanOrEqual(5);
  });

  it('rejects disallowed, mismatched and oversized file uploads', async () => {
    const organization = await makeOrganization('upload-validation');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'upload-admin');
    const cookie = cookieHeader(await login('org-admin', organization.code!, admin.email));
    const doc = await request(app).post('/api/notes').set('Cookie', cookie)
      .field('title', 'DOC').field('subject', 'Testing').field('description', 'Rejected')
      .attach('file', Buffer.from('doc'), { filename: 'handout.doc', contentType: 'application/msword' });
    expect(doc.status).toBe(400);
    const ppt = await request(app).post('/api/notes').set('Cookie', cookie)
      .field('title', 'PPT').field('subject', 'Testing').field('description', 'Rejected')
      .attach('file', Buffer.from('ppt'), { filename: 'slides.ppt', contentType: 'application/vnd.ms-powerpoint' });
    expect(ppt.status).toBe(400);
    const exe = await request(app).post('/api/notes').set('Cookie', cookie)
      .field('title', 'EXE').field('subject', 'Testing').field('description', 'Rejected')
      .attach('file', Buffer.from('exe'), { filename: 'payload.exe', contentType: 'application/octet-stream' });
    expect(exe.status).toBe(400);
    const wrongMime = await request(app).post('/api/notes').set('Cookie', cookie)
      .field('title', 'Mismatched').field('subject', 'Testing').field('description', 'Rejected')
      .attach('file', Buffer.from('wrong'), { filename: 'renamed.jpg', contentType: 'image/png' });
    expect(wrongMime.status).toBe(400);
    const oversized = await request(app).post('/api/notes').set('Cookie', cookie)
      .field('title', 'Oversized').field('subject', 'Testing').field('description', 'Rejected')
      .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' });
    expect(oversized.status).toBe(413);
  });
});

describe('PF-2 student portal APIs', () => {
  it('schedules and joins an enrolled class, records attendance, and blocks other-tenant students', async () => {
    const organization = await makeOrganization('portal-session');
    const otherOrganization = await makeOrganization('portal-session-other');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'portal-session-admin');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'portal-session-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'portal-session-student', { identifier: 'PORTAL-STU-1' });
    await makeUser(otherOrganization.id, Role.STUDENT, 'portal-session-other-student', { identifier: 'PORTAL-STU-2' });
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: 'PF2-SESSION',
        title: 'Portal Session Course',
        category: 'Testing',
        plannedHours: 10,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });

    await prisma.courseInstructor.create({ data: { organizationId: organization.id, courseId: course.id, instructorId: tutor.id } });
    await prisma.enrollment.create({ data: { organizationId: organization.id, courseId: course.id, studentId: student.id } });
    const tutorCookie = cookieHeader(await login('tutor', organization.code!, tutor.email));
    const studentCookie = cookieHeader(await login('students', organization.code!, 'PORTAL-STU-1'));
    const otherStudentCookie = cookieHeader(await login('students', otherOrganization.code!, 'PORTAL-STU-2'));
    const scheduled = await request(app).post('/api/portal/manage/sessions').set('Cookie', tutorCookie).send({
      courseId: course.id,
      title: 'Enrolled student session',
      description: 'PF-2 session integration test',
      startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      durationMinutes: 30,
    });
    expect(scheduled.status).toBe(201);
    const sessionId = scheduled.body.data.session.id as string;
    expect((await request(app).get('/api/portal/student/sessions').set('Cookie', otherStudentCookie)).body.data.sessions).toHaveLength(0);
    expect((await request(app).post(`/api/portal/student/sessions/${sessionId}/join`).set('Cookie', otherStudentCookie)).status).toBe(404);
    expect((await request(app).post(`/api/portal/student/sessions/${sessionId}/join`)).status).toBe(401);

    const joined = await request(app).post(`/api/portal/student/sessions/${sessionId}/join`).set('Cookie', studentCookie);
    expect(joined.status).toBe(200);
    expect(joined.body.data.room.roomUrl).toContain('https://meet.jit.si/');
    const marked = await request(app).put(`/api/portal/manage/sessions/${sessionId}/attendance/${student.id}`)
      .set('Cookie', tutorCookie).send({ status: 'ABSENT' });
    expect(marked.status).toBe(200);
    await prisma.expertSession.update({
      where: { id: sessionId },
      data: { startsAt: new Date(Date.now() - 40 * 60_000), status: 'COMPLETED' },
    });
    const summary = await request(app).get('/api/portal/student/attendance').set('Cookie', studentCookie);
    expect(summary.status).toBe(200);
    expect(summary.body.data.courses[0]).toMatchObject({ total: 1, present: 0, percentage: 0 });
    expect(summary.body.data.sessions[0].status).toBe('ABSENT');
  });

  it('publishes tenant-scoped Library content, saves it, and returns only the student’s certificates', async () => {
    const organization = await makeOrganization('portal-library');
    const otherOrganization = await makeOrganization('portal-library-other');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'portal-library-admin');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'portal-library-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'portal-library-student', { identifier: 'PORTAL-STU-3' });
    await makeUser(otherOrganization.id, Role.STUDENT, 'portal-library-other-student', { identifier: 'PORTAL-STU-4' });
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: 'PF2-LIBRARY',
        title: 'Portal Library Course',
        category: 'Testing',
        plannedHours: 10,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    await prisma.courseInstructor.create({ data: { organizationId: organization.id, courseId: course.id, instructorId: tutor.id } });
    await prisma.enrollment.create({ data: { organizationId: organization.id, courseId: course.id, studentId: student.id } });
    const tutorCookie = cookieHeader(await login('tutor', organization.code!, tutor.email));
    const studentCookie = cookieHeader(await login('students', organization.code!, 'PORTAL-STU-3'));
    const otherStudentCookie = cookieHeader(await login('students', otherOrganization.code!, 'PORTAL-STU-4'));
    const created = await request(app).post('/api/portal/manage/library').set('Cookie', tutorCookie).send({
      courseId: course.id,
      kind: 'NOTE',
      category: 'Science',
      title: 'Sample science book',
      description: 'Readable sample content.',
      contentText: 'Page one text.\n\nPage two text.',
    });
    expect(created.status).toBe(201);
    const itemId = created.body.data.item.id as string;
    expect((await request(app).patch(`/api/portal/manage/library/${itemId}`).set('Cookie', tutorCookie).send({ published: true })).status).toBe(200);
    const studentList = await request(app).get('/api/portal/student/library?search=science').set('Cookie', studentCookie);
    expect(studentList.status).toBe(200);
    expect(studentList.body.data.items).toHaveLength(1);
    expect((await request(app).get(`/api/portal/student/library/${itemId}`).set('Cookie', otherStudentCookie)).status).toBe(404);
    expect((await request(app).put(`/api/portal/student/library/${itemId}/saved`).set('Cookie', studentCookie)).status).toBe(200);
    const saved = await request(app).get('/api/portal/student/library?saved=true').set('Cookie', studentCookie);
    expect(saved.body.data.items[0].saved).toBe(true);

    const uploaded = await request(app).post('/api/portal/manage/library').set('Cookie', tutorCookie)
      .field('kind', 'DOCUMENT')
      .field('category', 'Science')
      .field('title', 'Science PDF sample')
      .field('description', 'A protected sample document.')
      .field('courseId', course.id)
      .attach('file', createSamplePdf('Science PDF sample', [['A readable first page.'], ['A readable second page.']]), {
        filename: 'science-sample.pdf',
        contentType: 'application/pdf',
      });
    expect(uploaded.status).toBe(201);
    const pdfItemId = uploaded.body.data.item.id as string;
    expect((await request(app).patch(`/api/portal/manage/library/${pdfItemId}`).set('Cookie', tutorCookie).send({ published: true })).status).toBe(200);
    const pdfContent = await request(app).get(`/api/portal/student/library/${pdfItemId}/content`).set('Cookie', studentCookie);
    expect(pdfContent.status).toBe(200);
    expect(pdfContent.headers['content-type']).toContain('application/pdf');
    expect(pdfContent.headers['content-disposition']).toContain('inline');
    expect(pdfContent.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect((await request(app).get(`/api/portal/student/library/${pdfItemId}/content`).set('Cookie', otherStudentCookie)).status).toBe(404);

    await prisma.certificate.create({
      data: {
        organizationId: organization.id,
        courseId: course.id,
        studentId: student.id,
        certificateNo: `${prefix}-CERT-1`,
        verificationCode: `${prefix}-VERIFY-1`,
      },
    });
    const certificates = await request(app).get('/api/portal/student/certificates').set('Cookie', studentCookie);
    expect(certificates.status).toBe(200);
    expect(certificates.body.data.certificates).toHaveLength(1);
    expect((await request(app).get(`/api/public/certificates/${prefix}-VERIFY-1`)).status).toBe(200);
    expect((await request(app).get('/api/portal/student/certificates').set('Cookie', otherStudentCookie)).body.data.certificates).toHaveLength(0);
  });
});

describe('Student profile, preferred Tutors, reviews, and saved notes', () => {
  it('encrypts student identifiers, audits administrator reveal, and scopes tutor reviews and saved notes', async () => {
    const organization = await makeOrganization('student-enhancements');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'enhancements-admin');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'enhancements-tutor');
    const otherTutor = await makeUser(organization.id, Role.TUTOR, 'enhancements-other-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'enhancements-student', { identifier: 'ENH-STU-1' });
    const otherStudent = await makeUser(organization.id, Role.STUDENT, 'enhancements-other-student', { identifier: 'ENH-STU-2' });
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        code: 'ENH-SAVED-NOTES',
        title: 'Saved notes course',
        category: 'Testing',
        plannedHours: 5,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    await prisma.enrollment.createMany({
      data: [
        { organizationId: organization.id, courseId: course.id, studentId: student.id },
        { organizationId: organization.id, courseId: course.id, studentId: otherStudent.id },
      ],
    });
    const studentCookie = cookieHeader(await login('students', organization.code!, 'ENH-STU-1'));
    const otherStudentCookie = cookieHeader(await login('students', organization.code!, 'ENH-STU-2'));
    const adminCookie = cookieHeader(await login('org-admin', organization.code!, admin.email));

    const updatedProfile = await request(app).put('/api/students/me').set('Cookie', studentCookie).send({
      fatherName: 'Parent One',
      motherName: 'Parent Two',
      currentEducation: 'Undergraduate',
      currentCourse: 'Computer Science',
      institutionName: 'Example College',
      aadhaarNumber: '123456789012',
      apaarId: '987654321098',
    });
    expect(updatedProfile.status).toBe(200);
    expect(updatedProfile.body.data.profile).toMatchObject({
      fatherName: 'Parent One',
      aadhaarNumber: '•••• •••• 9012',
      apaarId: '•••• •••• 1098',
    });
    const storedProfile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
    expect(storedProfile.aadhaarEncrypted).not.toContain('123456789012');
    expect(storedProfile.apaarIdEncrypted).not.toContain('987654321098');
    const revealed = await request(app).post('/api/students/ENH-STU-1/sensitive/reveal')
      .set('Cookie', adminCookie).send({ reason: 'Identity verification for account support' });
    expect(revealed.status).toBe(200);
    expect(revealed.body.data.identifiers).toEqual({ aadhaarNumber: '123456789012', apaarId: '987654321098' });
    expect(await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, actorId: admin.id, action: 'STUDENT_IDENTIFIERS_REVEALED', targetId: storedProfile.id },
    })).not.toBeNull();

    const available = await request(app).get('/api/tutors/available').set('Cookie', studentCookie);
    expect(available.status).toBe(200);
    expect(available.body.data.tutors.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([tutor.id, otherTutor.id]));
    expect((await request(app).put('/api/tutors/preferred').set('Cookie', studentCookie).send({ tutorId: tutor.id })).status).toBe(200);
    const firstReview = await request(app).put(`/api/tutors/${tutor.id}/review`).set('Cookie', studentCookie).send({ rating: 4, review: 'Helpful explanations.' });
    expect(firstReview.status).toBe(200);
    const updatedReview = await request(app).put(`/api/tutors/${tutor.id}/review`).set('Cookie', studentCookie).send({ rating: 5, review: 'Excellent support.' });
    expect(updatedReview.status).toBe(200);
    expect(await prisma.tutorReview.count({ where: { organizationId: organization.id, studentId: student.id, tutorId: tutor.id } })).toBe(1);
    const tutorDetail = await request(app).get(`/api/tutors/${tutor.id}`).set('Cookie', adminCookie);
    expect(tutorDetail.body.data.tutor.ratingSummary).toEqual({ averageRating: 5, reviewCount: 1 });
    expect(tutorDetail.body.data.tutor.reviews[0].student.studentId).toBe('ENH-STU-1');
    const tutorCookie = cookieHeader(await login('tutor', organization.code!, tutor.email));
    const tutorReviews = await request(app).get(`/api/tutors/${tutor.id}/reviews`).set('Cookie', tutorCookie);
    expect(tutorReviews.body.data.reviews.reviews[0].student).toBeNull();

    const note = await request(app).post('/api/notes').set('Cookie', tutorCookie)
      .field('title', 'Course-specific note')
      .field('subject', 'Testing')
      .field('description', 'A saved note for the selected course.')
      .field('courseId', course.id)
      .field('freePreview', 'true');
    expect(note.status).toBe(201);
    const noteId = note.body.data.note.id as string;
    expect((await request(app).post(`/api/notes/${noteId}/publish`).set('Cookie', tutorCookie)).status).toBe(200);
    expect((await request(app).put(`/api/notes/${noteId}/saved`).set('Cookie', studentCookie)).status).toBe(200);
    const savedByOwner = await request(app).get(`/api/notes?courseId=${course.id}&saved=true`).set('Cookie', studentCookie);
    const savedByOther = await request(app).get(`/api/notes?courseId=${course.id}&saved=true`).set('Cookie', otherStudentCookie);
    expect(savedByOwner.body.data.notes.map((item: { id: string }) => item.id)).toContain(noteId);
    expect(savedByOther.body.data.notes).toHaveLength(0);
    const ownCourse = await request(app).get(`/api/student/courses/${course.id}`).set('Cookie', studentCookie);
    const otherCourse = await request(app).get(`/api/student/courses/${course.id}`).set('Cookie', otherStudentCookie);
    expect(ownCourse.body.data.course.notes.map((item: { id: string }) => item.id)).toContain(noteId);
    expect(otherCourse.body.data.course.notes).toHaveLength(0);
  });
});

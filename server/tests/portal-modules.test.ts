import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, PrismaClient, Role, StudentStatus } from '@prisma/client';
import { app } from '../src/app.js';
import { localDiskStorage } from '../src/modules/notes/storage.service.js';

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
      ...(role === Role.STAFF ? {
        staffProfile: {
          create: {
            organizationId,
            staffId: options.identifier ?? `${prefix}-${suffix}`,
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

async function login(role: 'org-admin' | 'instructors' | 'staff' | 'students', organizationCode: string, identifier: string, secret = password) {
  const endpoint = role === 'org-admin'
    ? '/api/auth/org-admin/login'
    : `/api/auth/${role}/login`;
  const body = role === 'students'
    ? { organizationCode, studentId: identifier, password: secret }
    : role === 'staff'
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
    for (const note of storedNotes) {
      if (note.storageKey) await localDiskStorage.remove(note.storageKey);
    }
    await prisma.noteView.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.note.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.$disconnect();
});

describe('Checkpoint 1B staff and student directories', () => {
  it('creates staff with a one-time temporary password and enforces password change', async () => {
    const organization = await makeOrganization('staff');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'staff-admin');
    const adminLogin = await login('org-admin', organization.code!, admin.email);
    const adminCookie = cookieHeader(adminLogin);
    const temporaryPassword = 'OneTimeStaffPass!9';
    const created = await request(app).post('/api/staff').set('Cookie', adminCookie).send({
      staffId: 'NEW-STF-1',
      name: 'New Staff Member',
      phone: '+15555550124',
      email: `${prefix}-new-staff@example.test`,
      joiningDate: '2026-06-15',
      temporaryPassword,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.staff.user.status).toBe(AccountStatus.APPROVED);
    expect(created.body.data.staff.user.mustChangePassword).toBeUndefined();
    expect(created.body.data.temporaryPassword).toBe(temporaryPassword);
    const createdUser = await prisma.user.findFirstOrThrow({ where: { organizationId: organization.id, email: `${prefix}-new-staff@example.test` } });
    expect(createdUser.mustChangePassword).toBe(true);
    const duplicateStaffId = await request(app).post('/api/staff').set('Cookie', adminCookie).send({
      staffId: 'NEW-STF-1',
      name: 'Duplicate Staff ID',
      phone: '+15555550125',
      email: `${prefix}-duplicate-staff@example.test`,
      joiningDate: '2026-06-15',
      temporaryPassword,
    });
    expect(duplicateStaffId.status).toBe(409);

    const staffLogin = await login('staff', organization.code!, 'NEW-STF-1', temporaryPassword);
    expect(staffLogin.status).toBe(200);
    expect(staffLogin.body.data.user.mustChangePassword).toBe(true);
    const staffCookie = cookieHeader(staffLogin);
    expect((await request(app).get('/api/students').set('Cookie', staffCookie)).status).toBe(403);
    const changed = await request(app).post('/api/auth/change-password').set('Cookie', staffCookie).send({
      currentPassword: temporaryPassword,
      newPassword,
    });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/students').set('Cookie', staffCookie)).status).toBe(200);
    expect((await login('staff', organization.code!, 'NEW-STF-1', temporaryPassword)).status).toBe(401);
    expect((await login('staff', organization.code!, 'NEW-STF-1', newPassword)).status).toBe(200);

    const staffList = await request(app).get('/api/staff?search=NEW-STF-1').set('Cookie', adminCookie);
    expect(staffList.status).toBe(200);
    expect(staffList.body.data.staff).toHaveLength(1);
    expect(JSON.stringify(staffList.body)).not.toContain('passwordHash');
    expect(JSON.stringify(staffList.body)).not.toContain(temporaryPassword);
    const creationAuditCount = await prisma.auditLog.count({ where: { organizationId: organization.id, action: 'STAFF_CREATED' } });
    expect(creationAuditCount).toBe(1);
    expect((await request(app).post(`/api/staff/${createdUser.id}/suspend`).set('Cookie', adminCookie)).status).toBe(200);
    expect((await login('staff', organization.code!, 'NEW-STF-1', newPassword)).status).toBe(403);
    expect((await request(app).post(`/api/staff/${createdUser.id}/reactivate`).set('Cookie', adminCookie)).status).toBe(200);
    const activeStaffCookie = cookieHeader(await login('staff', organization.code!, 'NEW-STF-1', newPassword));
    expect((await request(app).post('/api/staff').set('Cookie', activeStaffCookie).send({})).status).toBe(403);
  });

  it('scopes student and staff search and detail data to the caller organization', async () => {
    const first = await makeOrganization('directory-a');
    const second = await makeOrganization('directory-b');
    const adminA = await makeUser(first.id, Role.ORG_ADMIN, 'directory-admin-a');
    const instructorB = await makeUser(second.id, Role.INSTRUCTOR, 'directory-instructor-b');
    const staffA = await makeUser(first.id, Role.STAFF, 'directory-staff-a', { identifier: 'STAFF-SEARCH-1' });
    const staffB = await makeUser(second.id, Role.STAFF, 'directory-staff-b', { identifier: 'STAFF-SEARCH-1' });
    const studentA = await makeUser(first.id, Role.STUDENT, 'directory-student-a', { identifier: 'STUDENT-SEARCH-1' });
    const studentB = await makeUser(second.id, Role.STUDENT, 'directory-student-b', { identifier: 'STUDENT-SEARCH-1' });
    await makeUser(second.id, Role.STUDENT, 'directory-student-b-other', { identifier: 'OTHER-STU-1' });
    const adminLogin = await login('org-admin', first.code!, adminA.email);
    const instructorLogin = await login('instructors', second.code!, instructorB.email);
    const staffLogin = await login('staff', first.code!, 'STAFF-SEARCH-1');
    const adminCookie = cookieHeader(adminLogin);
    const instructorCookie = cookieHeader(instructorLogin);
    const staffCookie = cookieHeader(staffLogin);

    const students = await request(app).get('/api/students?search=STUDENT-SEARCH-1').set('Cookie', adminCookie);
    expect(students.status).toBe(200);
    expect(students.body.data.students.map((student: { user: { id: string } }) => student.user.id)).toEqual([studentA.id]);
    const otherStudents = await request(app).get('/api/students?search=STUDENT-SEARCH-1').set('Cookie', instructorCookie);
    expect(otherStudents.body.data.students.map((student: { user: { id: string } }) => student.user.id)).toEqual([studentB.id]);
    const otherStudentDetail = await request(app).get('/api/students/STUDENT-SEARCH-1').set('Cookie', adminCookie);
    expect(otherStudentDetail.status).toBe(200);
    const crossStudent = await request(app).get('/api/students/OTHER-STU-1').set('Cookie', adminCookie);
    expect(crossStudent.status).toBe(404);

    const staffSearch = await request(app).get('/api/staff?search=STAFF-SEARCH-1').set('Cookie', adminCookie);
    expect(staffSearch.status).toBe(200);
    expect(staffSearch.body.data.staff.map((member: { user: { id: string } }) => member.user.id)).toEqual([staffA.id]);
    const crossStaff = await request(app).get(`/api/staff/${staffB.id}`).set('Cookie', adminCookie);
    expect(crossStaff.status).toBe(404);
    expect((await request(app).post(`/api/staff/${staffA.id}/suspend`).set('Cookie', staffCookie)).status).toBe(403);
    const studentCookie = cookieHeader(await login('students', first.code!, 'STUDENT-SEARCH-1'));
    expect((await request(app).get('/api/students').set('Cookie', studentCookie)).status).toBe(403);
    expect((await request(app).get('/api/staff').set('Cookie', studentCookie)).status).toBe(403);
  });

  it('returns safe student profile login summaries and audits suspension actions', async () => {
    const organization = await makeOrganization('student-details');
    const instructor = await makeUser(organization.id, Role.INSTRUCTOR, 'student-details-instructor');
    const student = await makeUser(organization.id, Role.STUDENT, 'student-details-student', { identifier: 'DETAIL-STU-1' });
    await prisma.loginLog.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        organizationId: organization.id,
        userId: student.id,
        success: true,
        createdAt: new Date(Date.now() - index * 1000),
      })),
    });
    const instructorLogin = await login('instructors', organization.code!, instructor.email);
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
    const instructor = await makeUser(first.id, Role.INSTRUCTOR, 'notes-instructor');
    await makeUser(first.id, Role.STAFF, 'notes-staff');
    const student = await makeUser(first.id, Role.STUDENT, 'notes-student', { identifier: 'NOTE-STUDENT-1' });
    const otherAdmin = await makeUser(second.id, Role.ORG_ADMIN, 'notes-other-admin');
    const adminCookie = cookieHeader(await login('org-admin', first.code!, admin.email));
    const instructorCookie = cookieHeader(await login('instructors', first.code!, instructor.email));
    const staffCookie = cookieHeader(await login('staff', first.code!, `${prefix}-notes-staff@example.test`));
    const studentCookie = cookieHeader(await login('students', first.code!, 'NOTE-STUDENT-1'));
    const otherCookie = cookieHeader(await login('org-admin', second.code!, otherAdmin.email));

    const staffNote = await createNote(staffCookie, { title: 'Staff published image', published: true, filename: 'staff.png' });
    const instructorNote = await createNote(instructorCookie, { title: 'Instructor draft' });
    const adminNote = await createNote(adminCookie, { title: 'Admin draft' });
    const otherNote = await createNote(otherCookie, { title: 'Other organization published', published: true, filename: 'other.png' });
    expect(staffNote.status).toBe(201);
    expect(instructorNote.status).toBe(201);
    expect(adminNote.status).toBe(201);
    expect(otherNote.status).toBe(201);
    const staffNoteId = staffNote.body.data.note.id as string;
    const instructorNoteId = instructorNote.body.data.note.id as string;
    const adminNoteId = adminNote.body.data.note.id as string;
    const otherNoteId = otherNote.body.data.note.id as string;

    expect((await request(app).patch(`/api/notes/${instructorNoteId}`).set('Cookie', staffCookie).send({ title: 'not owner' })).status).toBe(403);
    expect((await request(app).delete(`/api/notes/${instructorNoteId}`).set('Cookie', staffCookie)).status).toBe(403);
    expect((await request(app).patch(`/api/notes/${staffNoteId}`).set('Cookie', staffCookie).send({ title: 'Staff edited own note' })).status).toBe(200);
    expect((await request(app).patch(`/api/notes/${staffNoteId}`).set('Cookie', adminCookie).send({ title: 'Admin edited any note' })).status).toBe(200);
    expect((await request(app).post(`/api/notes/${instructorNoteId}/publish`).set('Cookie', instructorCookie)).status).toBe(200);

    const studentList = await request(app).get('/api/notes').set('Cookie', studentCookie);
    expect(studentList.status).toBe(200);
    expect(studentList.body.data.notes.map((note: { id: string }) => note.id)).toContain(staffNoteId);
    expect(studentList.body.data.notes.map((note: { id: string }) => note.id)).not.toContain(adminNoteId);
    expect(JSON.stringify(studentList.body)).not.toContain('/api/notes/');
    expect((await request(app).get(`/api/notes/${adminNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);
    expect((await request(app).get(`/api/notes/${otherNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);

    const studentView = await request(app).get(`/api/notes/${staffNoteId}/view`).set('Cookie', studentCookie);
    expect(studentView.status).toBe(200);
    expect(studentView.headers['cache-control']).toBe('no-store');
    expect(studentView.headers['content-disposition']).toContain('inline');
    expect(studentView.headers['x-content-type-options']).toBe('nosniff');
    expect(studentView.body.toString()).toBe('phase 1b test file');
    expect(await prisma.noteView.count({ where: { organizationId: first.id, noteId: staffNoteId, userId: student.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: first.id, action: 'NOTE_VIEWED', targetId: staffNoteId, actorId: student.id } })).toBe(1);

    const deniedStudentMutations = await Promise.all([
      request(app).post('/api/notes').set('Cookie', studentCookie).send({ title: 'Forbidden', subject: 'Test', description: 'No' }),
      request(app).patch(`/api/notes/${staffNoteId}`).set('Cookie', studentCookie).send({ title: 'Forbidden' }),
      request(app).delete(`/api/notes/${staffNoteId}`).set('Cookie', studentCookie),
      request(app).post(`/api/notes/${staffNoteId}/publish`).set('Cookie', studentCookie),
      request(app).post(`/api/notes/${staffNoteId}/unpublish`).set('Cookie', studentCookie),
      request(app).get(`/api/notes/${staffNoteId}/download`).set('Cookie', studentCookie),
    ]);
    expect(deniedStudentMutations.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect((await request(app).get(`/api/notes/${otherNoteId}/download`).set('Cookie', staffCookie)).status).toBe(404);
    expect((await request(app).get(`/api/notes/${staffNoteId}/download`).set('Cookie', staffCookie)).headers['content-disposition']).toContain('attachment');

    expect((await request(app).post(`/api/notes/${staffNoteId}/unpublish`).set('Cookie', staffCookie)).status).toBe(200);
    expect((await request(app).post(`/api/notes/${staffNoteId}/publish`).set('Cookie', staffCookie)).status).toBe(200);
    expect((await request(app).delete(`/api/notes/${staffNoteId}`).set('Cookie', staffCookie)).status).toBe(204);
    expect((await request(app).get(`/api/notes/${staffNoteId}/view`).set('Cookie', studentCookie)).status).toBe(404);
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

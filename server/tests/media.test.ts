import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  AccountStatus,
  CourseStatus,
  MediaJobStatus,
  MediaStatus,
  OrganizationStatus,
  PrismaClient,
  Role,
  StudentStatus,
} from '@prisma/client';
import { env } from '../src/config/env.js';
import { app } from '../src/app.js';
import { localMediaStorage } from '../src/modules/media/media.storage.js';
import { processNextJob, recoverInterruptedJobs } from '../src/modules/media/media.worker.js';
import type { MediaProcessor } from '../src/modules/media/media.processor.js';

const prisma = new PrismaClient();
const password = 'TestPass!1234';
const prefix = `media-${Date.now()}`;
const organizations: string[] = [];

async function makeOrganization(suffix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} ${suffix}`,
      code: `${prefix}-${suffix}`,
      headName: 'Media Test Head',
      contactNumber: '+15555550100',
      email: `${prefix}-${suffix}@example.test`,
      address: 'Media Test Street',
      city: 'Test City',
      state: 'Test State',
      country: 'Test Country',
      status: OrganizationStatus.ACTIVE,
    },
  });
  organizations.push(organization.id);
  return organization;
}

async function makeUser(organizationId: string, role: Role, name: string) {
  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `${prefix}-${name}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      name,
      phone: '+15555550101',
      role,
      status: AccountStatus.APPROVED,
      ...(role === Role.STUDENT ? {
        studentProfile: { create: { organizationId, studentId: `${prefix}-${name}`, status: StudentStatus.APPROVED } },
      } : {}),
      ...(role === Role.STAFF ? {
        staffProfile: { create: { organizationId, staffId: `${prefix}-${name}` } },
      } : {}),
    },
  });
  return user;
}

async function makeCourse(organizationId: string, creatorId: string, code: string) {
  const course = await prisma.course.create({
    data: {
      organizationId,
      code,
      title: `${prefix} ${code}`,
      category: 'Media tests',
      plannedHours: 10,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2027-01-01T00:00:00.000Z'),
      status: CourseStatus.PUBLISHED,
      createdById: creatorId,
    },
  });
  const topic = await prisma.courseTopic.create({
    data: { organizationId, courseId: course.id, title: 'Topic one', plannedHours: 1, order: 1 },
  });
  return { course, topic };
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const value = response.headers['set-cookie'];
  return (Array.isArray(value) ? value : value ? [value] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function login(role: 'staff' | 'students' | 'org-admin', organizationCode: string, identifier: string) {
  const body = role === 'students'
    ? { organizationCode, studentId: identifier, password }
    : role === 'staff'
      ? { organizationCode, identifier, password }
      : { organizationCode, email: `${prefix}-${identifier}@example.test`, password };
  const endpoint = role === 'org-admin' ? '/api/auth/org-admin/login' : `/api/auth/${role}/login`;
  const response = await request(app).post(endpoint).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return cookieHeader(response);
}

function mp4Fixture() {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4);
  buffer.write('isom', 8);
  buffer.writeUInt32BE(0x200, 12);
  buffer.write('isom', 16);
  buffer.write('iso2', 20);
  buffer.write('mp41', 24);
  return buffer;
}

async function createMedia(cookie: string, courseId: string, title: string, file = mp4Fixture()) {
  const created = await request(app).post('/api/media').set('Cookie', cookie).send({
    title,
    description: 'Media fixture',
    courseId,
    type: 'VIDEO',
    sizeBytes: file.length,
    extension: '.mp4',
    mimeType: 'video/mp4',
    fileName: 'sample.mp4',
  });
  expect(created.status).toBe(201);
  return created.body.data.media as { id: string; sizeBytes: number };
}

async function uploadMedia(cookie: string, mediaId: string, file = mp4Fixture()) {
  return request(app)
    .put(`/api/media/${mediaId}/file`)
    .set('Cookie', cookie)
    .set('X-Media-Extension', '.mp4')
    .set('Content-Type', 'video/mp4')
    .send(file);
}

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  const rows = await prisma.mediaItem.findMany({
    where: { organizationId: { in: organizations } },
    select: { originalKey: true, streamKey: true },
  });
  for (const row of rows) {
    if (row.originalKey) await localMediaStorage.removeKey(row.originalKey);
    if (row.streamKey?.startsWith('processed/')) {
      await localMediaStorage.removeProcessedDirectory(row.streamKey.slice('processed/'.length));
    }
  }
  if (organizations.length) {
    await prisma.watchProgress.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.mediaJob.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.mediaItem.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  }
  await prisma.$disconnect();
});

describe('Part B media management', () => {
  it('enforces media roles, ownership, tenant scoping, type, signature, size, and quota', async () => {
    const organization = await makeOrganization('first');
    const otherOrganization = await makeOrganization('second');
    const staff = await makeUser(organization.id, Role.STAFF, 'staff');
    await makeUser(organization.id, Role.STAFF, 'other-staff');
    const student = await makeUser(organization.id, Role.STUDENT, 'student');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
    const otherTenantStaff = await makeUser(otherOrganization.id, Role.STAFF, 'tenant-staff');
    const { course } = await makeCourse(organization.id, staff.id, 'MEDIA101');
    const otherCourse = await makeCourse(otherOrganization.id, otherTenantStaff.id, 'MEDIA202');
    const staffCookie = await login('staff', organization.code!, `${prefix}-staff`);
    const otherStaffCookie = await login('staff', organization.code!, `${prefix}-other-staff`);
    const studentCookie = await login('students', organization.code!, `${prefix}-student`);
    const adminCookie = await login('org-admin', organization.code!, 'admin');
    const otherTenantCookie = await login('staff', otherOrganization.code!, `${prefix}-tenant-staff`);

    expect((await request(app).post('/api/media').set('Cookie', studentCookie).send({})).status).toBe(403);
    expect((await request(app).patch('/api/media/not-a-media-id').set('Cookie', studentCookie).send({})).status).toBe(403);
    expect((await request(app).delete('/api/media/not-a-media-id').set('Cookie', studentCookie)).status).toBe(403);

    const mismatchedType = await request(app).post('/api/media').set('Cookie', staffCookie).send({
      title: 'Wrong MIME',
      courseId: course.id,
      type: 'VIDEO',
      sizeBytes: 32,
      extension: '.mp4',
      mimeType: 'audio/mpeg',
      fileName: 'sample.mp4',
    });
    expect(mismatchedType.status).toBe(400);

    const traversalName = await request(app).post('/api/media').set('Cookie', staffCookie).send({
      title: 'Traversal',
      courseId: course.id,
      type: 'VIDEO',
      sizeBytes: 32,
      extension: '.mp4',
      mimeType: 'video/mp4',
      fileName: '..\\outside.mp4',
    });
    expect(traversalName.status).toBe(400);

    const previousMax = env.MAX_VIDEO_MB;
    env.MAX_VIDEO_MB = 1;
    try {
      const tooLarge = await request(app).post('/api/media').set('Cookie', staffCookie).send({
        title: 'Too Large',
        courseId: course.id,
        type: 'VIDEO',
        sizeBytes: 1024 * 1024 + 1,
        extension: '.mp4',
        mimeType: 'video/mp4',
        fileName: 'sample.mp4',
      });
      expect(tooLarge.status).toBe(413);
    } finally {
      env.MAX_VIDEO_MB = previousMax;
    }

    const previousQuota = env.MEDIA_STORAGE_QUOTA_GB;
    env.MEDIA_STORAGE_QUOTA_GB = 0.000001;
    try {
      const overQuota = await request(app).post('/api/media').set('Cookie', staffCookie).send({
        title: 'Over Quota',
        courseId: course.id,
        type: 'VIDEO',
        sizeBytes: 2000,
        extension: '.mp4',
        mimeType: 'video/mp4',
        fileName: 'sample.mp4',
      });
      expect(overQuota.status).toBe(413);
    } finally {
      env.MEDIA_STORAGE_QUOTA_GB = previousQuota;
    }

    const media = await createMedia(staffCookie, course.id, 'Signature Validation');
    const invalidSignature = await uploadMedia(staffCookie, media.id, Buffer.from('not a video'));
    expect(invalidSignature.status).toBe(400);

    const validMedia = await createMedia(staffCookie, course.id, 'Tenant Isolation');
    expect((await uploadMedia(staffCookie, validMedia.id)).status).toBe(202);
    const row = await prisma.mediaItem.findFirstOrThrow({ where: { id: validMedia.id, organizationId: organization.id } });
    expect(row.status).toBe(MediaStatus.PROCESSING);
    expect(row.originalKey).toMatch(/^originals\//);

    const unauthorizedEdit = await request(app).patch(`/api/media/${validMedia.id}`)
      .set('Cookie', otherStaffCookie)
      .send({ title: 'Changed', description: '', courseId: course.id, topicId: null });
    expect(unauthorizedEdit.status).toBe(404);
    expect((await request(app).delete(`/api/media/${validMedia.id}`).set('Cookie', otherStaffCookie)).status).toBe(404);

    const adminEdit = await request(app).patch(`/api/media/${validMedia.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Changed by Org Admin', description: '', courseId: course.id, topicId: null });
    expect(adminEdit.status).toBe(200);

    await prisma.mediaItem.update({
      where: { id: validMedia.id },
      data: { status: MediaStatus.READY, streamKey: `processed/${organization.id}/${validMedia.id}/fixture` },
    });
    await prisma.mediaJob.update({
      where: { organizationId_mediaId: { organizationId: organization.id, mediaId: validMedia.id } },
      data: { status: MediaJobStatus.SUCCEEDED, progressPercent: 100 },
    });
    const foreignPaths = [
      `/api/media/${validMedia.id}/stream/master.m3u8`,
      `/api/media/${validMedia.id}/stream/720/segment_00000.ts`,
      `/api/media/${validMedia.id}/key`,
    ];
    for (const path of foreignPaths) {
      expect((await request(app).get(path).set('Cookie', otherTenantCookie)).status).toBe(404);
    }
    expect(otherCourse.course.organizationId).not.toBe(organization.id);
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, targetType: 'MediaItem' } })).toBeGreaterThan(0);
    expect(student.organizationId).toBe(organization.id);
    expect(admin.organizationId).toBe(organization.id);
  });

  it('processes jobs, persists progress, retries failures, and recovers interrupted work', async () => {
    const organization = await makeOrganization('worker');
    const staff = await makeUser(organization.id, Role.STAFF, 'worker-staff');
    const { course } = await makeCourse(organization.id, staff.id, 'WORK101');
    const staffCookie = await login('staff', organization.code!, `${prefix}-worker-staff`);
    const media = await createMedia(staffCookie, course.id, 'Processor Lifecycle');
    expect((await uploadMedia(staffCookie, media.id)).status).toBe(202);

    const fakeProcessor: MediaProcessor = {
      async process(input, onProgress) {
        await onProgress(35);
        await onProgress(80);
        return {
          streamKey: `processed/${input.organizationId}/${input.id}/result`,
          thumbnailKey: null,
          durationSeconds: 10,
          processedBytes: 100,
        };
      },
    };
    expect(await processNextJob(fakeProcessor, organization.id)).toBe(true);
    const ready = await prisma.mediaItem.findFirstOrThrow({
      where: { id: media.id, organizationId: organization.id },
      include: { job: true },
    });
    expect(ready.status).toBe(MediaStatus.READY);
    expect(ready.durationSeconds).toBe(10);
    expect(ready.job?.status).toBe(MediaJobStatus.SUCCEEDED);
    expect(ready.job?.progressPercent).toBe(100);

    const failureMedia = await createMedia(staffCookie, course.id, 'Retry Lifecycle');
    expect((await uploadMedia(staffCookie, failureMedia.id)).status).toBe(202);
    const failingProcessor: MediaProcessor = {
      async process() { throw new Error('test processor failure'); },
    };
    const previousAttempts = env.MEDIA_PROCESSING_MAX_ATTEMPTS;
    env.MEDIA_PROCESSING_MAX_ATTEMPTS = 2;
    try {
      expect(await processNextJob(failingProcessor, organization.id)).toBe(true);
      let failedJob = await prisma.mediaJob.findFirstOrThrow({
        where: { organizationId: organization.id, mediaId: failureMedia.id },
      });
      expect(failedJob.status).toBe(MediaJobStatus.QUEUED);
      await prisma.mediaJob.update({ where: { id: failedJob.id }, data: { availableAt: new Date(0) } });
      expect(await processNextJob(failingProcessor, organization.id)).toBe(true);
      failedJob = await prisma.mediaJob.findFirstOrThrow({ where: { id: failedJob.id } });
      expect(failedJob.status).toBe(MediaJobStatus.FAILED);

      await prisma.mediaJob.update({
        where: { id: failedJob.id },
        data: { status: MediaJobStatus.PROCESSING, startedAt: new Date() },
      });
      await prisma.mediaItem.update({ where: { id: failureMedia.id }, data: { status: MediaStatus.PROCESSING } });
      await recoverInterruptedJobs(organization.id);
      const recovered = await prisma.mediaJob.findFirstOrThrow({ where: { id: failedJob.id } });
      expect(recovered.status).toBe(MediaJobStatus.QUEUED);
      expect(recovered.error).toContain('interrupted by a server restart');
    } finally {
      env.MEDIA_PROCESSING_MAX_ATTEMPTS = previousAttempts;
    }
  });
});

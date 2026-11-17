import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
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
import { ffmpegMediaProcessor, type MediaProcessor } from '../src/modules/media/media.processor.js';

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
      ...(role === Role.TUTOR ? {
        tutorProfile: { create: { organizationId, tutorId: `${prefix}-${name}` } },
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
  await prisma.courseInstructor.create({ data: { organizationId, courseId: course.id, instructorId: creatorId } });
  return { course, topic };
}

function cookieHeader(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const value = response.headers['set-cookie'];
  return (Array.isArray(value) ? value : value ? [value] : []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function login(role: 'tutor' | 'students' | 'org-admin', organizationCode: string, identifier: string) {
  const body = role === 'students'
    ? { organizationCode, studentId: identifier, password }
    : role === 'tutor'
      ? { organizationCode, identifier, password }
      : { organizationCode, email: `${prefix}-${identifier}@example.test`, password };
  const endpoint = role === 'org-admin'
    ? '/api/auth/org-admin/login'
    : role === 'tutor'
      ? '/api/auth/tutors/login'
      : `/api/auth/${role}/login`;
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

async function createMedia(cookie: string, courseId: string, title: string, sizeBytes = mp4Fixture().length) {
  const created = await request(app).post('/api/media').set('Cookie', cookie).send({
    title,
    description: 'Media fixture',
    courseId,
    type: 'VIDEO',
    sizeBytes,
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

async function generateLargeVideo(path: string) {
  const ffmpeg: unknown = createRequire(import.meta.url)('ffmpeg-static');
  if (typeof ffmpeg !== 'string') throw new Error('No bundled FFmpeg binary is available for this platform');
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-t', '25',
      '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-b:v', '64M', '-minrate', '64M', '-maxrate', '64M', '-bufsize', '128M',
      '-x264-params', 'nal-hrd=cbr',
      '-movflags', '+faststart',
      path,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`FFmpeg large video generation failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function uploadVideoFile(cookie: string, mediaId: string, path: string, size: number) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the media upload test server');

  try {
    return await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
      const upload = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/media/${mediaId}/file`,
        method: 'PUT',
        headers: {
          Cookie: cookie,
          'X-Media-Extension': '.mp4',
          'Content-Type': 'video/mp4',
          'Content-Length': size,
        },
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { body += chunk; });
        response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, body }));
      });
      upload.once('error', reject);
      const file = createReadStream(path);
      file.once('error', reject);
      file.pipe(upload);
    });
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
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
  it('lists only enrolled student media without exposing storage keys', async () => {
    const organization = await makeOrganization('student-media-list');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'student-media-list-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'SML1');
    await makeUser(organization.id, Role.STUDENT, 'SML2');
    const { course } = await makeCourse(organization.id, tutor.id, 'STUDENTMEDIA');
    await prisma.enrollment.create({
      data: { organizationId: organization.id, courseId: course.id, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    const tutorCookie = await login('tutor', organization.code!, `${prefix}-student-media-list-tutor`);
    const studentCookie = await login('students', organization.code!, `${prefix}-SML1`);
    const unenrolledCookie = await login('students', organization.code!, `${prefix}-SML2`);
    const media = await createMedia(tutorCookie, course.id, 'Student media serialization');
    const incoming = await localMediaStorage.createIncomingFile();
    await localMediaStorage.writeIncoming(Readable.from([Buffer.from('sample video')]), incoming.path, 100);
    const originalKey = await localMediaStorage.adoptIncoming(incoming.path, organization.id, media.id, '.mp4');
    const work = localMediaStorage.createWorkDirectory(organization.id, media.id);
    await mkdir(work.path, { recursive: true });
    await writeFile(join(work.path, 'thumbnail.jpg'), Buffer.from('sample thumbnail'));
    await localMediaStorage.promoteWorkDirectory(work.path, work.key);
    await prisma.mediaItem.update({
      where: { id: media.id },
      data: {
        status: MediaStatus.READY,
        visibility: 'PUBLISHED',
        originalKey,
        streamKey: `processed/${work.key}`,
        thumbnailKey: `processed/${work.key}/thumbnail.jpg`,
      },
    });

    const listed = await request(app).get('/api/student/media').set('Cookie', studentCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.items[0]).toMatchObject({
      id: media.id,
      title: 'Student media serialization',
      thumbnailUrl: `/student/media/${media.id}/stream/thumbnail.jpg`,
    });
    const serialized = JSON.stringify(listed.body);
    expect(serialized).not.toContain('originals/');
    expect(serialized).not.toContain('processed/');
    expect(listed.body.data.items[0]).not.toHaveProperty('originalKey');
    expect(listed.body.data.items[0]).not.toHaveProperty('streamKey');
    expect(listed.body.data.items[0]).not.toHaveProperty('thumbnailKey');
    expect((await request(app).get('/api/student/media').set('Cookie', unenrolledCookie)).body.data.items).toHaveLength(0);
  });

  it('uploads, processes, publishes, and plays a 180 MB video', async () => {
    expect(env.MAX_VIDEO_MB).toBeGreaterThanOrEqual(180);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jll-large-media-'));
    const videoPath = join(temporaryDirectory, 'large-video.mp4');
    const previousKeepOriginal = env.KEEP_ORIGINAL_MEDIA;
    env.KEEP_ORIGINAL_MEDIA = true;

    try {
      await generateLargeVideo(videoPath);
      const { size } = await stat(videoPath);
      expect(size).toBeGreaterThanOrEqual(180 * 1024 * 1024);

      const organization = await makeOrganization('large-video');
      const tutor = await makeUser(organization.id, Role.TUTOR, 'large-video-tutor');
      const student = await makeUser(organization.id, Role.STUDENT, 'large-video-student');
      await makeUser(organization.id, Role.STUDENT, 'unenrolled');
      const { course } = await makeCourse(organization.id, tutor.id, 'LARGEVIDEO');
      await prisma.enrollment.create({
        data: {
          organizationId: organization.id,
          courseId: course.id,
          studentId: student.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      const tutorCookie = await login('tutor', organization.code!, `${prefix}-large-video-tutor`);
      const media = await createMedia(tutorCookie, course.id, '180 MB video', size);
      const upload = await uploadVideoFile(tutorCookie, media.id, videoPath, size);
      expect(upload.status, upload.body).toBe(202);

      expect(await processNextJob(ffmpegMediaProcessor, organization.id)).toBe(true);
      const ready = await prisma.mediaItem.findFirstOrThrow({
        where: { id: media.id, organizationId: organization.id },
        include: { job: true },
      });
      expect(ready.status).toBe(MediaStatus.READY);
      expect(ready.job?.status).toBe(MediaJobStatus.SUCCEEDED);
      expect(ready.job?.progressPercent).toBe(100);

      const publish = await request(app).post(`/api/media/${media.id}/publish`).set('Cookie', tutorCookie);
      expect(publish.status).toBe(200);
      expect(publish.body.data.media.visibility).toBe('PUBLISHED');

      const studentCookie = await login('students', organization.code!, `${prefix}-large-video-student`);
      const player = await request(app).get(`/api/student/media/${media.id}`).set('Cookie', studentCookie);
      expect(player.status).toBe(200);
      const progressiveRange = await request(app)
        .get(`/api/student/media/${media.id}/progressive`)
        .set('Cookie', studentCookie)
        .set('Range', 'bytes=0-31');
      expect(progressiveRange.status).toBe(206);
      expect(progressiveRange.headers['content-range']).toBe(`bytes 0-31/${size}`);
      expect(progressiveRange.body).toHaveLength(32);
      const invalidRange = await request(app)
        .get(`/api/student/media/${media.id}/progressive`)
        .set('Cookie', studentCookie)
        .set('Range', `bytes=${size}-`);
      expect(invalidRange.status).toBe(416);
      expect(invalidRange.headers['content-range']).toBe(`bytes */${size}`);
      const playlist = await request(app)
        .get(`/api/student/media/${media.id}/stream/master.m3u8`)
        .set('Cookie', studentCookie);
      expect(playlist.status).toBe(200);
      expect(playlist.text).toContain('720/index.m3u8');
      expect(playlist.text).toContain('480/index.m3u8');

      const rendition = await request(app)
        .get(`/api/student/media/${media.id}/stream/720/index.m3u8`)
        .set('Cookie', studentCookie);
      expect(rendition.status).toBe(200);
      const segment = rendition.text.split(/\r?\n/).find((line) => line.endsWith('.ts'));
      expect(segment).toBeDefined();
      const playableSegment = await request(app)
        .get(`/api/student/media/${media.id}/stream/720/${segment}`)
        .set('Cookie', studentCookie);
      expect(playableSegment.status).toBe(200);
      expect(playableSegment.headers['content-type']).toContain('video/mp2t');

      const key = await request(app).get(`/api/media/${media.id}/key`).set('Cookie', studentCookie);
      expect(key.status).toBe(200);
      expect(key.body).toHaveLength(16);

      const unenrolledCookie = await login('students', organization.code!, `${prefix}-unenrolled`);
      const deniedKey = await request(app).get(`/api/media/${media.id}/key`).set('Cookie', unenrolledCookie);
      expect(deniedKey.status).toBe(404);
      expect((await request(app).get(`/api/student/media/${media.id}/progressive`).set('Cookie', unenrolledCookie).set('Range', 'bytes=0-1')).status).toBe(404);
    } finally {
      env.KEEP_ORIGINAL_MEDIA = previousKeepOriginal;
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 600_000);

  it('resumes empty drafts and validates, previews, and publishes YouTube links', async () => {
    const organization = await makeOrganization('sources');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'source-tutor');
    const { course } = await makeCourse(organization.id, tutor.id, 'SOURCE101');
    const tutorCookie = await login('tutor', organization.code!, `${prefix}-source-tutor`);

    const draftResponse = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
      title: 'Resumable upload draft',
      courseId: course.id,
      type: 'VIDEO',
    });
    expect(draftResponse.status).toBe(201);
    const draft = draftResponse.body.data.media as { id: string; status: string };
    expect(draft.status).toBe('AWAITING_FILE');
    expect((await uploadMedia(tutorCookie, draft.id)).status).toBe(202);
    const resumed = await prisma.mediaItem.findUniqueOrThrow({ where: { id: draft.id } });
    expect(resumed.status).toBe(MediaStatus.PROCESSING);
    expect(resumed.sizeBytes).toBe(BigInt(mp4Fixture().length));

    const invalidLink = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
      title: 'Invalid YouTube link',
      courseId: course.id,
      type: 'VIDEO',
      source: 'YOUTUBE',
      youtubeUrl: 'https://example.com/watch?v=dQw4w9WgXcQ',
    });
    expect(invalidLink.status).toBe(400);

    const linked = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
      title: 'YouTube lesson',
      courseId: course.id,
      type: 'VIDEO',
      source: 'YOUTUBE',
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(linked.status).toBe(201);
    expect(linked.body.data.media).toMatchObject({
      source: 'YOUTUBE',
      youtubeVideoId: 'dQw4w9WgXcQ',
      status: 'READY',
      visibility: 'DRAFT',
    });
    const publish = await request(app).post(`/api/media/${linked.body.data.media.id}/publish`).set('Cookie', tutorCookie);
    expect(publish.status).toBe(200);
    expect(publish.body.data.media.visibility).toBe('PUBLISHED');
  });

  it('enforces media roles, ownership, tenant scoping, type, signature, size, and quota', async () => {
    const organization = await makeOrganization('first');
    const otherOrganization = await makeOrganization('second');
    const tutor = await makeUser(organization.id, Role.TUTOR, 'tutor');
    await makeUser(organization.id, Role.TUTOR, 'other-tutor');
    const student = await makeUser(organization.id, Role.STUDENT, 'student');
    const admin = await makeUser(organization.id, Role.ORG_ADMIN, 'admin');
    const otherTenantTutor = await makeUser(otherOrganization.id, Role.TUTOR, 'tenant-tutor');
    const { course } = await makeCourse(organization.id, tutor.id, 'MEDIA101');
    const otherCourse = await makeCourse(otherOrganization.id, otherTenantTutor.id, 'MEDIA202');
    const tutorCookie = await login('tutor', organization.code!, `${prefix}-tutor`);
    const otherTutorCookie = await login('tutor', organization.code!, `${prefix}-other-tutor`);
    const studentCookie = await login('students', organization.code!, `${prefix}-student`);
    const adminCookie = await login('org-admin', organization.code!, 'admin');
    const otherTenantCookie = await login('tutor', otherOrganization.code!, `${prefix}-tenant-tutor`);

    expect((await request(app).post('/api/media').set('Cookie', studentCookie).send({})).status).toBe(403);
    expect((await request(app).patch('/api/media/not-a-media-id').set('Cookie', studentCookie).send({})).status).toBe(403);
    expect((await request(app).delete('/api/media/not-a-media-id').set('Cookie', studentCookie)).status).toBe(403);

    const mismatchedType = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
      title: 'Wrong MIME',
      courseId: course.id,
      type: 'VIDEO',
      sizeBytes: 32,
      extension: '.mp4',
      mimeType: 'audio/mpeg',
      fileName: 'sample.mp4',
    });
    expect(mismatchedType.status).toBe(400);

    const traversalName = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
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
      const tooLarge = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
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
      const overQuota = await request(app).post('/api/media').set('Cookie', tutorCookie).send({
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

    const media = await createMedia(tutorCookie, course.id, 'Signature Validation');
    const invalidSignature = await uploadMedia(tutorCookie, media.id, Buffer.from('not a video'));
    expect(invalidSignature.status).toBe(400);

    const validMedia = await createMedia(tutorCookie, course.id, 'Tenant Isolation');
    expect((await uploadMedia(tutorCookie, validMedia.id)).status).toBe(202);
    const row = await prisma.mediaItem.findFirstOrThrow({ where: { id: validMedia.id, organizationId: organization.id } });
    expect(row.status).toBe(MediaStatus.PROCESSING);
    expect(row.originalKey).toMatch(/^originals\//);

    const unauthorizedEdit = await request(app).patch(`/api/media/${validMedia.id}`)
      .set('Cookie', otherTutorCookie)
      .send({ title: 'Changed', description: '', courseId: course.id, topicId: null });
    expect(unauthorizedEdit.status).toBe(404);
    expect((await request(app).delete(`/api/media/${validMedia.id}`).set('Cookie', otherTutorCookie)).status).toBe(404);

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
    const tutor = await makeUser(organization.id, Role.TUTOR, 'worker-tutor');
    const { course } = await makeCourse(organization.id, tutor.id, 'WORK101');
    const tutorCookie = await login('tutor', organization.code!, `${prefix}-worker-tutor`);
    const media = await createMedia(tutorCookie, course.id, 'Processor Lifecycle');
    expect((await uploadMedia(tutorCookie, media.id)).status).toBe(202);

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

    const failureMedia = await createMedia(tutorCookie, course.id, 'Retry Lifecycle');
    expect((await uploadMedia(tutorCookie, failureMedia.id)).status).toBe(202);
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

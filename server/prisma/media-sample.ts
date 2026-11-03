import 'dotenv/config';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { AccountStatus, MediaJobStatus, MediaStatus, MediaType, PrismaClient, Role } from '@prisma/client';
import { env } from '../src/config/env.js';
import { createMedia } from '../src/modules/media/media.service.js';
import { localMediaStorage } from '../src/modules/media/media.storage.js';

const prisma = new PrismaClient();
const ffmpeg: unknown = createRequire(import.meta.url)('ffmpeg-static');

function runFfmpeg(args: string[]) {
  if (typeof ffmpeg !== 'string') throw new Error('No bundled FFmpeg binary is available for this platform');
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`FFmpeg sample generation failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function registerSample(input: {
  organizationId: string;
  uploaderId: string;
  course: { id: string; code: string };
  title: string;
  type: MediaType;
  extension: string;
  mimeType: string;
  format: string;
  args: string[];
}) {
  const existing = await prisma.mediaItem.findFirst({
    where: {
      organizationId: input.organizationId,
      courseId: input.course.id,
      title: input.title,
      type: input.type,
      deletedAt: null,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    console.log(`Already registered: ${input.course.code} ${input.title} (${existing.status})`);
    return;
  }

  const temporary = await localMediaStorage.createIncomingFile();
  let mediaId: string | undefined;
  let originalKey: string | undefined;
  try {
    await runFfmpeg([...input.args, '-f', input.format, temporary.path]);
    const file = await fileTypeFromFile(temporary.path);
    if (!file || file.mime !== input.mimeType) {
      throw new Error(`Generated sample does not match expected type ${input.mimeType}`);
    }
    const { size } = await stat(temporary.path);
    const media = await createMedia({
      organizationId: input.organizationId,
      userId: input.uploaderId,
      role: Role.STAFF,
    }, {
      title: input.title,
      description: 'Locally generated 10-second Part B media sample.',
      courseId: input.course.id,
      topicId: null,
      type: input.type,
      sizeBytes: size,
      extension: input.extension,
      mimeType: input.mimeType,
      fileName: `sample${input.extension}`,
    });
    mediaId = media.id;
    originalKey = await localMediaStorage.adoptIncoming(temporary.path, input.organizationId, media.id, input.extension);
    await prisma.$transaction(async (tx) => {
      await tx.mediaItem.update({
        where: { id: media.id },
        data: { status: MediaStatus.PROCESSING, originalKey },
      });
      await tx.mediaJob.create({
        data: { organizationId: input.organizationId, mediaId: media.id, status: MediaJobStatus.QUEUED },
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.uploaderId,
          action: 'MEDIA_SAMPLE_REGISTERED',
          targetType: 'MediaItem',
          targetId: media.id,
          metadata: { courseCode: input.course.code, type: input.type },
        },
      });
    });
    console.log(`Registered: ${input.course.code} ${input.title} (${size} bytes)`);
  } catch (error) {
    await localMediaStorage.removeIncoming(temporary.path);
    if (originalKey) await localMediaStorage.removeKey(originalKey);
    if (mediaId) {
      await prisma.mediaItem.updateMany({
        where: { id: mediaId, organizationId: input.organizationId, deletedAt: null },
        data: { deletedAt: new Date(), storageBytes: 0n },
      });
    }
    throw error;
  }
}

async function main() {
  if (!ffmpeg) throw new Error('The ffmpeg-static package has no binary for this platform');
  const organization = await prisma.organization.findUnique({ where: { code: 'jll-demo' }, select: { id: true } });
  if (!organization) throw new Error('Seed the jll-demo organization before generating media samples');
  const uploader = await prisma.user.findFirst({
    where: { organizationId: organization.id, role: Role.STAFF, status: AccountStatus.APPROVED, isActive: true },
    select: { id: true },
  });
  if (!uploader) throw new Error('An approved jll-demo staff account is required to register media samples');
  const courses = await prisma.course.findMany({
    where: { organizationId: organization.id, code: { in: ['PY101', 'JAV101', 'JS101'] } },
    select: { id: true, code: true },
  });
  const byCode = new Map(courses.map((course) => [course.code, course]));
  const missing = ['PY101', 'JAV101', 'JS101'].filter((code) => !byCode.has(code));
  if (missing.length) throw new Error(`Missing sample courses: ${missing.join(', ')}`);

  const sharedVideoArgs = [
    '-f', 'lavfi',
    '-i', 'testsrc=size=640x360:rate=24',
    '-f', 'lavfi',
    '-i', 'sine=frequency=880:duration=10',
    '-t', '10',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
  ];
  await registerSample({
    organizationId: organization.id,
    uploaderId: uploader.id,
    course: byCode.get('PY101')!,
    title: 'Part B Sample Video',
    type: MediaType.VIDEO,
    extension: '.mp4',
    mimeType: 'video/mp4',
    format: 'mp4',
    args: sharedVideoArgs,
  });
  await registerSample({
    organizationId: organization.id,
    uploaderId: uploader.id,
    course: byCode.get('JAV101')!,
    title: 'Part B Sample Video 2',
    type: MediaType.VIDEO,
    extension: '.mp4',
    mimeType: 'video/mp4',
    format: 'mp4',
    args: sharedVideoArgs,
  });
  await registerSample({
    organizationId: organization.id,
    uploaderId: uploader.id,
    course: byCode.get('JS101')!,
    title: 'Part B Sample Audio',
    type: MediaType.AUDIO,
    extension: '.wav',
    mimeType: 'audio/wav',
    format: 'wav',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-t', '10', '-c:a', 'pcm_s16le', '-ar', '44100'],
  });
  console.log(`Media sample generation complete. Video max: ${env.MAX_VIDEO_MB} MB; audio max: ${env.MAX_AUDIO_MB} MB.`);
}

main()
  .catch((error: unknown) => {
    console.error('Media sample generation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

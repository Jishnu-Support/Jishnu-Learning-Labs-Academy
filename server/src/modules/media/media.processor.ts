import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ffprobeStatic from 'ffprobe-static';
import { MediaType } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { mediaStorage } from './media.storage.js';

const ffmpegPath: unknown = createRequire(import.meta.url)('ffmpeg-static');

export type ProcessorInput = {
  id: string;
  organizationId: string;
  type: MediaType;
  originalKey: string;
};

export type ProcessorResult = {
  streamKey: string;
  thumbnailKey: string | null;
  durationSeconds: number;
  processedBytes: number;
};

export type MediaProcessor = {
  process(input: ProcessorInput, onProgress: (progressPercent: number) => Promise<void>): Promise<ProcessorResult>;
};

function runProcess(
  executable: string,
  args: string[],
  onProgress?: (outTimeMicroseconds: number) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const process = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us' && value && onProgress) onProgress(Number(value));
        if (key === 'out_time_ms' && value && onProgress) onProgress(Number(value));
      }
    });
    process.stderr.on('data', (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8000);
    });
    process.once('error', reject);
    process.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Media processing exited with code ${code}: ${stderrBuffer.trim().slice(-2000)}`));
    });
  });
}

async function probeDuration(inputPath: string): Promise<number> {
  const result = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(ffprobeStatic.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`ffprobe exited with code ${code}: ${stderr.trim()}`));
    });
  });
  const duration = Number(result);
  if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(422, 'Could not determine media duration');
  return Math.ceil(duration);
}

async function directorySize(path: string): Promise<number> {
  return mediaStorage.sizeOfDirectory(path);
}

export const ffmpegMediaProcessor: MediaProcessor = {
  async process(input, onProgress) {
    if (typeof ffmpegPath !== 'string') throw new Error('No bundled FFmpeg binary is available for this platform');
    const source = await mediaStorage.open(input.originalKey);
    const durationSeconds = await probeDuration(source.path);
    const workspace = mediaStorage.createWorkDirectory(input.organizationId, input.id);
    await mkdir(workspace.path, { recursive: true });
    let progressChain = Promise.resolve();
    const reportProgress = (progressPercent: number) => {
      progressChain = progressChain.then(() => onProgress(progressPercent)).catch((error: unknown) => {
        logger.error({ err: error, mediaId: input.id }, 'Unable to persist media processing progress');
      });
    };

    try {
      if (input.type === MediaType.AUDIO) {
        const outputPath = join(workspace.path, 'audio.m4a');
        await runProcess(ffmpegPath, [
          '-hide_banner', '-y', '-i', source.path,
          '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
          '-progress', 'pipe:1', '-nostats', outputPath,
        ], (outTime) => {
          reportProgress(Math.min(99, Math.max(0, Math.floor((outTime / 1_000_000 / durationSeconds) * 100))));
        });
        await progressChain;
        const processedBytes = await directorySize(workspace.path);
        await mediaStorage.promoteWorkDirectory(workspace.path, workspace.key);
        return {
          streamKey: `processed/${workspace.key}`,
          thumbnailKey: null,
          durationSeconds,
          processedBytes,
        };
      }

      const encryptionKey = randomBytes(16);
      const encryptionIv = randomBytes(16).toString('hex');
      const encryptionKeyPath = join(workspace.path, 'enc.key');
      const keyInfoPath = join(workspace.path, 'enc.keyinfo');
      await writeFile(encryptionKeyPath, encryptionKey, { flag: 'wx' });
      await writeFile(keyInfoPath, `/api/media/${input.id}/key\n${encryptionKeyPath}\n${encryptionIv}\n`, { flag: 'wx' });

      for (const rendition of [720, 480]) {
        const renditionDirectory = join(workspace.path, String(rendition));
        await mkdir(renditionDirectory, { recursive: true });
        await runProcess(ffmpegPath, [
          '-hide_banner', '-y', '-i', source.path,
          '-vf', `scale=-2:${rendition}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
          '-c:a', 'aac', '-b:a', '128k',
          '-hls_time', '6', '-hls_playlist_type', 'vod',
          '-hls_key_info_file', keyInfoPath,
          '-hls_segment_filename', join(renditionDirectory, 'segment_%05d.ts'),
          '-progress', 'pipe:1', '-nostats',
          join(renditionDirectory, 'index.m3u8'),
        ], (outTime) => {
          const progress = (outTime / 1_000_000 / durationSeconds) * (rendition === 720 ? 45 : 45) +
            (rendition === 720 ? 0 : 45);
          reportProgress(Math.min(95, Math.max(0, Math.floor(progress))));
        });
      }
      await progressChain;

      const thumbnailPath = join(workspace.path, 'thumbnail.jpg');
      await runProcess(ffmpegPath, [
        '-hide_banner', '-y', '-ss', '1', '-i', source.path,
        '-frames:v', '1', '-vf', 'scale=640:-2', thumbnailPath,
      ]);
      const masterPlaylist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
        '720/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480',
        '480/index.m3u8',
        '',
      ].join('\n');
      await writeFile(join(workspace.path, 'master.m3u8'), masterPlaylist, { flag: 'wx' });
      const processedBytes = await directorySize(workspace.path);
      await mediaStorage.promoteWorkDirectory(workspace.path, workspace.key);
      return {
        streamKey: `processed/${workspace.key}`,
        thumbnailKey: `processed/${workspace.key}/thumbnail.jpg`,
        durationSeconds,
        processedBytes,
      };
    } catch (error) {
      await mediaStorage.removeWorkDirectory(workspace.path);
      throw error;
    }
  },
};

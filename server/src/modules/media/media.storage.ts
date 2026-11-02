import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

const root = isAbsolute(env.MEDIA_STORAGE_DIR)
  ? resolve(env.MEDIA_STORAGE_DIR)
  : resolve(process.cwd(), env.MEDIA_STORAGE_DIR);
const incomingRoot = join(root, 'incoming');
const workRoot = join(root, 'work');
const originalRoot = join(root, 'originals');
const processedRoot = join(root, 'processed');

export type MediaStorageService = {
  createIncomingFile(): Promise<{ path: string; key: string }>;
  writeIncoming(request: NodeJS.ReadableStream, path: string, maximumBytes: number): Promise<number>;
  adoptIncoming(path: string, organizationId: string, mediaId: string, extension: string): Promise<string>;
  createWorkDirectory(organizationId: string, mediaId: string): { path: string; key: string };
  processedDirectory(key: string): string;
  processedKey(workKey: string, asset: string): string;
  promoteWorkDirectory(workPath: string, workKey: string): Promise<void>;
  removeIncoming(path: string): Promise<void>;
  cleanStaleIncoming(maxAgeMs?: number): Promise<number>;
  removeWorkDirectory(path: string): Promise<void>;
  removeProcessedDirectory(key: string): Promise<void>;
  open(key: string): Promise<{ stream: ReadStream; size: number; path: string }>;
  readKey(key: string): Promise<Buffer>;
  removeKey(key: string): Promise<void>;
  sizeOfDirectory(path: string): Promise<number>;
  ensureWorkspace(key: string): Promise<string>;
  relativePath(path: string, base: string): string;
};

function safePath(base: string, key: string): string {
  if (!key || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new HttpError(404, 'Media file not found');
  }
  const filePath = resolve(base, ...key.split('/'));
  if (!filePath.startsWith(`${base}${sep}`)) throw new HttpError(404, 'Media file not found');
  return filePath;
}

function mediaPath(base: string, key: string): string {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._/-]+$/.test(key)) {
    throw new HttpError(404, 'Media file not found');
  }
  return safePath(base, key);
}

export const localMediaStorage: MediaStorageService = {
  async createIncomingFile(): Promise<{ path: string; key: string }> {
    await mkdir(incomingRoot, { recursive: true });
    const key = `${randomUUID()}.upload`;
    return { path: safePath(incomingRoot, key), key };
  },

  async writeIncoming(request: NodeJS.ReadableStream, path: string, maximumBytes: number): Promise<number> {
    const tempRoot = resolve(incomingRoot);
    if (!resolve(path).startsWith(`${tempRoot}${sep}`)) throw new HttpError(400, 'Invalid upload destination');
    let size = 0;
    const limiter = new (await import('node:stream')).Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maximumBytes) {
          callback(new HttpError(413, 'The uploaded file exceeds the configured size limit'));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(request, limiter, createWriteStream(path, { flags: 'wx' }));
    return size;
  },

  async adoptIncoming(path: string, organizationId: string, mediaId: string, extension: string): Promise<string> {
    const tempRoot = resolve(incomingRoot);
    if (!resolve(path).startsWith(`${tempRoot}${sep}`)) throw new HttpError(400, 'Invalid upload destination');
    const key = `${organizationId}/${mediaId}/${randomUUID()}${extension}`;
    const target = mediaPath(originalRoot, key);
    await mkdir(resolve(target, '..'), { recursive: true });
    await rename(path, target);
    return `originals/${key}`;
  },

  createWorkDirectory(organizationId: string, mediaId: string): { path: string; key: string } {
    const key = `${organizationId}/${mediaId}/${randomUUID()}`;
    return { path: mediaPath(workRoot, `${key}/placeholder`).replace(`${sep}placeholder`, ''), key };
  },

  processedDirectory(key: string): string {
    return mediaPath(processedRoot, `${key}/placeholder`).replace(`${sep}placeholder`, '');
  },

  processedKey(workKey: string, asset: string): string {
    if (!/^[a-zA-Z0-9._/-]+$/.test(asset) || asset.split('/').some((part) => part === '..' || part === '.')) {
      throw new HttpError(404, 'Media file not found');
    }
    return `processed/${workKey}/${asset}`;
  },

  async promoteWorkDirectory(workPath: string, workKey: string): Promise<void> {
    const resolvedWorkPath = resolve(workPath);
    if (!resolvedWorkPath.startsWith(`${resolve(workRoot)}${sep}`)) throw new HttpError(400, 'Invalid processing directory');
    const destination = this.processedDirectory(workKey);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await rename(resolvedWorkPath, destination);
  },

  async removeIncoming(path: string): Promise<void> {
    const resolvedPath = resolve(path);
    if (!resolvedPath.startsWith(`${resolve(incomingRoot)}${sep}`)) return;
    await rm(resolvedPath, { force: true });
  },

  async cleanStaleIncoming(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    await mkdir(incomingRoot, { recursive: true });
    const now = Date.now();
    const entries = await readdir(incomingRoot, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.upload$/.test(entry.name)) continue;
      const path = safePath(incomingRoot, entry.name);
      if (now - (await stat(path)).mtimeMs < maxAgeMs) continue;
      await rm(path, { force: true });
      removed += 1;
    }
    return removed;
  },

  async removeWorkDirectory(path: string): Promise<void> {
    const resolvedPath = resolve(path);
    if (!resolvedPath.startsWith(`${resolve(workRoot)}${sep}`)) return;
    await rm(resolvedPath, { recursive: true, force: true });
  },

  async removeProcessedDirectory(key: string): Promise<void> {
    const path = this.processedDirectory(key);
    if (!path.startsWith(`${resolve(processedRoot)}${sep}`)) throw new HttpError(400, 'Invalid media directory');
    await rm(path, { recursive: true, force: true });
  },

  async open(key: string): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; path: string }> {
    const isOriginal = key.startsWith('originals/');
    if (!isOriginal && !key.startsWith('processed/')) throw new HttpError(404, 'Media file not found');
    const normalized = key.replace(/^(originals|processed)\//, '');
    const filePath = mediaPath(isOriginal ? originalRoot : processedRoot, normalized);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new HttpError(404, 'Media file not found');
      return { stream: createReadStream(filePath), size: fileStat.size, path: filePath };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new HttpError(404, 'Media file not found');
      }
      throw error;
    }
  },

  async readKey(key: string): Promise<Buffer> {
    const file = await this.open(key);
    return new Promise((resolvePromise, reject) => {
      const chunks: Buffer[] = [];
      file.stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      file.stream.on('end', () => resolvePromise(Buffer.concat(chunks)));
      file.stream.on('error', reject);
    });
  },

  async removeKey(key: string): Promise<void> {
    const file = await this.open(key);
    await rm(file.path);
  },

  async sizeOfDirectory(path: string): Promise<number> {
    const resolvedPath = resolve(path);
    if (!resolvedPath.startsWith(`${resolve(workRoot)}${sep}`) &&
      !resolvedPath.startsWith(`${resolve(processedRoot)}${sep}`)) {
      throw new HttpError(400, 'Invalid media directory');
    }
    let total = 0;
    const pending = [resolvedPath];
    while (pending.length) {
      const current = pending.pop()!;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(current, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile()) total += (await stat(entryPath)).size;
      }
    }
    return total;
  },

  async ensureWorkspace(key: string): Promise<string> {
    const path = this.processedDirectory(key);
    await mkdir(path, { recursive: true });
    return path;
  },

  relativePath(path: string, base: string): string {
    const value = relative(base, path).split(sep).join('/');
    if (value.startsWith('../') || value === '..') throw new HttpError(400, 'Invalid media path');
    return value;
  },
};

export const mediaStorage: MediaStorageService = localMediaStorage;

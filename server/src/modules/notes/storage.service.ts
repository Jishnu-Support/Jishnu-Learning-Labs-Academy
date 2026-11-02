import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

export type StorageService = {
  save(buffer: Buffer, extension: string): Promise<string>;
  open(key: string): Promise<{ stream: ReadStream; size: number }>;
  remove(key: string): Promise<void>;
};

const allowedExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const root = isAbsolute(env.NOTE_STORAGE_DIR) ? resolve(env.NOTE_STORAGE_DIR) : resolve(process.cwd(), env.NOTE_STORAGE_DIR);

function resolveKey(key: string): string {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|webp)$/.test(key)) throw new HttpError(404, 'Note file not found');
  const filePath = resolve(root, key);
  if (!filePath.startsWith(`${root}${sep}`)) throw new HttpError(404, 'Note file not found');
  return filePath;
}

export const localDiskStorage: StorageService = {
  async save(buffer, extension) {
    if (!allowedExtensions.has(extension)) throw new HttpError(400, 'Unsupported note file type');
    await mkdir(root, { recursive: true });
    const key = `${randomUUID()}${extension}`;
    await writeFile(resolveKey(key), buffer, { flag: 'wx' });
    return key;
  },
  async open(key) {
    const filePath = resolveKey(key);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new HttpError(404, 'Note file not found');
      return { stream: createReadStream(filePath), size: fileStat.size };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new HttpError(404, 'Note file not found');
      }
      throw error;
    }
  },
  async remove(key) {
    try {
      await unlink(resolveKey(key));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  },
};

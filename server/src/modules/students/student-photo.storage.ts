import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

const root = isAbsolute(env.STUDENT_STORAGE_DIR)
  ? resolve(env.STUDENT_STORAGE_DIR)
  : resolve(process.cwd(), env.STUDENT_STORAGE_DIR);

function resolveKey(key: string) {
  if (!/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(key)) {
    throw new HttpError(404, 'Student profile photo not found');
  }
  const filePath = resolve(root, key);
  if (!filePath.startsWith(`${root}${sep}`)) throw new HttpError(404, 'Student profile photo not found');
  return filePath;
}

export const studentPhotoStorage = {
  async save(buffer: Buffer, extension: string) {
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      throw new HttpError(400, 'Unsupported profile photo type');
    }
    await mkdir(root, { recursive: true });
    const key = `${randomUUID()}${extension}`;
    await writeFile(resolveKey(key), buffer, { flag: 'wx' });
    return key;
  },
  async open(key: string): Promise<{ stream: ReadStream; size: number }> {
    try {
      const filePath = resolveKey(key);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new HttpError(404, 'Student profile photo not found');
      return { stream: createReadStream(filePath), size: fileStat.size };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new HttpError(404, 'Student profile photo not found');
      }
      throw error;
    }
  },
  async remove(key: string) {
    try {
      await unlink(resolveKey(key));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  },
};

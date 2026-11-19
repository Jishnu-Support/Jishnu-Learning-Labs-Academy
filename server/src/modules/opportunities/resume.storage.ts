import { basename, extname } from 'node:path';
import type { Express } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { HttpError } from '../../utils/http-error.js';
import { localDiskStorage } from '../notes/storage.service.js';

const maximumResumeBytes = 5 * 1024 * 1024;
const resumeTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);

function hasDocSignature(buffer: Buffer) {
  return buffer.subarray(0, 8).equals(Buffer.from('D0CF11E0A1B11AE1', 'hex'));
}

function hasDocxSignature(buffer: Buffer) {
  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    && buffer.includes('[Content_Types].xml')
    && buffer.includes('word/document.xml');
}

export async function saveResume(file: Express.Multer.File | undefined) {
  if (!file) return null;
  if (file.size > maximumResumeBytes) throw new HttpError(413, 'Resume files must be 5 MB or smaller');
  const extension = extname(file.originalname).toLowerCase();
  const mimeType = resumeTypes.get(extension);
  if (!mimeType || file.mimetype.toLowerCase() !== mimeType) {
    throw new HttpError(400, 'Resume must be a PDF, DOC, or DOCX file with a matching file type');
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  const validSignature = extension === '.pdf'
    ? detected?.mime === 'application/pdf'
    : extension === '.doc'
      ? hasDocSignature(file.buffer)
      : (detected?.ext === 'docx' || hasDocxSignature(file.buffer));
  if (!validSignature) throw new HttpError(400, 'Resume file contents do not match the selected file type');
  const originalName = basename(file.originalname.replaceAll('\\', '/')).replace(/[\r\n"]/g, '').slice(0, 255);
  if (!originalName) throw new HttpError(400, 'Resume must have a valid filename');
  const storageKey = await localDiskStorage.save(file.buffer, extension);
  return { storageKey, originalName, mimeType };
}

export async function openResume(storageKey: string) {
  const file = await localDiskStorage.open(storageKey);
  const extension = extname(storageKey).toLowerCase();
  const mimeType = resumeTypes.get(extension);
  if (!mimeType) throw new HttpError(404, 'Resume not found');
  return { ...file, mimeType };
}

export async function removeResume(storageKey: string | null | undefined) {
  if (storageKey) await localDiskStorage.remove(storageKey);
}

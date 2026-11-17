import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

function encryptionKey() {
  const key = env.PII_ENCRYPTION_KEY;
  const decoded = key ? Buffer.from(key, 'base64') : Buffer.alloc(0);
  if (decoded.length !== 32) {
    throw new HttpError(503, 'Student identity encryption is not configured');
  }
  return decoded;
}

export function encryptStudentIdentifier(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decryptStudentIdentifier(value: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split('.');
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored student identifier is invalid');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskStudentIdentifier(last4: string | null) {
  return last4 ? `XXXX XXXX ${last4}` : null;
}

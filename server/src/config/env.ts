import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  REQUIRE_ORG_APPROVAL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REQUIRE_ENROLLMENT_APPROVAL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SHOW_PARTNER_ORG_NAME: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  STUDY_MATERIALS_SAVED_ONLY: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  NOTE_STORAGE_DIR: z.string().default('storage/notes'),
  TUTOR_STORAGE_DIR: z.string().default('storage/tutors'),
  STUDENT_STORAGE_DIR: z.string().default('storage/students'),
  PII_ENCRYPTION_KEY: z.string().optional().default(process.env.STUDENT_ID_ENCRYPTION_KEY ?? ''),
  ENABLE_AADHAAR_FIELD: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MEDIA_STORAGE_DIR: z.string().default('storage/media'),
  MEDIA_STORAGE_QUOTA_GB: z.coerce.number().positive().default(10),
  MAX_VIDEO_MB: z.coerce.number().int().positive().default(500),
  MAX_AUDIO_MB: z.coerce.number().int().positive().default(100),
  KEEP_ORIGINAL_MEDIA: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MEDIA_PROCESSING_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PAYMENT_PROVIDER: z.enum(['MOCK', 'RAZORPAY']).default('MOCK'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.union([z.literal(''), z.string().url()]).default(''),
  AZURE_OPENAI_API_KEY: z.string().default(''),
  AZURE_OPENAI_DEPLOYMENT: z.string().default(''),
  AZURE_OPENAI_API_VERSION: z.string().min(1).default('2024-10-21'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.PII_ENCRYPTION_KEY) {
    context.addIssue({ code: 'custom', path: ['PII_ENCRYPTION_KEY'], message: 'PII_ENCRYPTION_KEY is required in production' });
  }
  if (value.PII_ENCRYPTION_KEY && Buffer.from(value.PII_ENCRYPTION_KEY, 'base64').length !== 32) {
    context.addIssue({ code: 'custom', path: ['PII_ENCRYPTION_KEY'], message: 'PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key' });
  }
  const azureOpenAiConfigured = Boolean(value.AZURE_OPENAI_ENDPOINT || value.AZURE_OPENAI_API_KEY || value.AZURE_OPENAI_DEPLOYMENT);
  if (azureOpenAiConfigured && (!value.AZURE_OPENAI_ENDPOINT || !value.AZURE_OPENAI_API_KEY || !value.AZURE_OPENAI_DEPLOYMENT)) {
    context.addIssue({
      code: 'custom',
      path: ['AZURE_OPENAI_ENDPOINT'],
      message: 'AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT must be configured together',
    });
  }
});

export const env = envSchema.parse(process.env);

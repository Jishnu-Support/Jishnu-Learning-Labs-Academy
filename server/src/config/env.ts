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
  NOTE_STORAGE_DIR: z.string().default('storage/notes'),
  MEDIA_STORAGE_DIR: z.string().default('storage/media'),
  MEDIA_STORAGE_QUOTA_GB: z.coerce.number().positive().default(10),
  MAX_VIDEO_MB: z.coerce.number().int().positive().default(500),
  MAX_AUDIO_MB: z.coerce.number().int().positive().default(100),
  KEEP_ORIGINAL_MEDIA: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MEDIA_PROCESSING_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export const env = envSchema.parse(process.env);

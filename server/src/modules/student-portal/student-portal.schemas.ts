import { AttendanceMark, LibraryKind } from '@prisma/client';
import { z } from 'zod';

const id = z.string().min(1).max(64);

export const sessionIdSchema = z.object({ sessionId: id });
export const courseIdSchema = z.object({ courseId: id });
export const sessionAttendanceParamsSchema = z.object({ sessionId: id, studentId: id });
export const libraryItemIdSchema = z.object({ itemId: id });
export const verificationCodeSchema = z.object({ verificationCode: z.string().min(16).max(100) });
export const studentReportsQuerySchema = z.object({ courseId: id.optional() });

export const sessionListQuerySchema = z.object({
  tab: z.enum(['LIVE', 'UPCOMING', 'PAST']).optional(),
  courseId: id.optional(),
});

export const createSessionSchema = z.object({
  courseId: id,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(''),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(240),
  freePreview: z.boolean().optional().default(false),
});

export const updateSessionSchema = createSessionSchema.partial();

export const attendanceMarkSchema = z.object({ status: z.nativeEnum(AttendanceMark) });

export const libraryQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  courseId: id.optional(),
  category: z.string().trim().max(80).optional(),
  kind: z.nativeEnum(LibraryKind).optional(),
  saved: z.enum(['true', 'false']).optional(),
  view: z.enum(['cards', 'list']).optional(),
});

export const createLibraryItemSchema = z.object({
  courseId: id.nullable().optional(),
  kind: z.nativeEnum(LibraryKind),
  freePreview: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean()).optional().default(false),
  category: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(''),
  contentText: z.string().trim().max(100_000).optional(),
  externalUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', 'Links must use HTTPS').optional(),
}).superRefine((item, context) => {
  if (item.kind === 'LINK' && !item.externalUrl) {
    context.addIssue({ code: 'custom', path: ['externalUrl'], message: 'A secure URL is required for links' });
  }
});

export const updateLibraryItemSchema = z.object({
  published: z.boolean().optional(),
  freePreview: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean()).optional(),
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
});

export const gameRatingSchema = z.object({
  gameKey: z.enum(['flashcards', 'quick-quiz', 'word-match']),
  rating: z.number().int().min(1).max(5),
});

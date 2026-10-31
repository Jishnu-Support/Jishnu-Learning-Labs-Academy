import { z } from 'zod';

export const courseIdSchema = z.object({ courseId: z.string().trim().min(1).max(64) });
export const createCourseSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(5000).optional(),
});
export const updateCourseSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
}).refine((value) => value.title !== undefined || value.description !== undefined, {
  message: 'Provide a title or description to update',
});

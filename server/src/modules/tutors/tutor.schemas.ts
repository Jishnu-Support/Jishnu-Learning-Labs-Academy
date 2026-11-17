import { AccountStatus } from '@prisma/client';
import { z } from 'zod';
import { emailSchema, phoneSchema } from '../../utils/validation-schemas.js';

const tutorIdSchema = z.string().trim().min(1).max(40);
const newTutorIdSchema = z.string().trim().regex(/^TUT-[A-Z0-9-]+$/i, 'Use a Tutor ID starting with TUT-').max(40);
const tutorFields = {
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: emailSchema,
  joiningDate: z.string().date(),
  bio: z.string().trim().max(2000).optional(),
  expertise: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
};

export const createTutorSchema = z.object({
  ...tutorFields,
  tutorId: newTutorIdSchema,
  temporaryPassword: z.string().min(8).max(128),
});

export const updateTutorSchema = z.object({
  ...tutorFields,
  tutorId: tutorIdSchema,
}).partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const tutorListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const tutorParamSchema = z.object({ userId: z.string().cuid() });
export const tutorReviewParamSchema = z.object({ reviewId: z.string().cuid() });
export const courseParamSchema = z.object({ courseId: z.string().cuid() });
export const tutorCourseQuerySchema = z.object({ courseId: z.string().cuid().optional() });
export const preferredTutorSchema = z.object({ tutorId: z.string().cuid(), courseId: z.string().cuid() });
export const tutorReviewSchema = z.object({
  courseId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  review: z.string().trim().max(500).nullable().optional(),
});
export const deleteTutorReviewSchema = z.object({ courseId: z.string().cuid() });
export const hideTutorReviewSchema = z.object({
  hidden: z.boolean(),
  reason: z.string().trim().min(8).max(500),
});

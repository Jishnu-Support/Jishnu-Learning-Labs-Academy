import { z } from 'zod';

const courseFields = {
  code: z.string().trim().min(2).max(24).regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use uppercase letters, numbers, and hyphens'),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().min(2).max(100),
  plannedHours: z.number().int().min(1).max(10000),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  minimumAttendancePercent: z.number().int().min(0).max(100),
  requiresAssessmentPass: z.boolean(),
  instructorIds: z.array(z.string().cuid()).min(1).max(20),
};

export const courseIdSchema = z.object({ courseId: z.string().cuid() });
export const topicIdSchema = z.object({ courseId: z.string().cuid(), topicId: z.string().cuid() });
export const enrollmentIdSchema = z.object({ courseId: z.string().cuid(), enrollmentId: z.string().cuid() });

export const createCourseSchema = z.object(courseFields).refine(
  (value) => value.endDate >= value.startDate,
  { message: 'End date must be on or after the start date', path: ['endDate'] },
);

export const updateCourseSchema = z.object({
  ...courseFields,
  instructorIds: z.array(z.string().cuid()).min(1).max(20).optional(),
}).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update' },
).refine(
  (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
  { message: 'End date must be on or after the start date', path: ['endDate'] },
);

export const courseListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const enrollmentListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});
export const studentCourseListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export const createTopicSchema = z.object({
  title: z.string().trim().min(2).max(160),
  plannedHours: z.number().int().min(1).max(1000),
});

export const reorderTopicsSchema = z.object({
  topicIds: z.array(z.string().cuid()).min(1).max(200),
}).refine((value) => new Set(value.topicIds).size === value.topicIds.length, {
  message: 'Topic IDs must be unique',
  path: ['topicIds'],
});

export const updateTopicSchema = z.object({
  covered: z.boolean(),
});

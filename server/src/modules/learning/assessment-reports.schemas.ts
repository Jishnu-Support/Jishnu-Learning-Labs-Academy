import { QuestionDifficulty } from '@prisma/client';
import { z } from 'zod';

export const assessmentReportQuerySchema = z.object({
  courseId: z.string().min(1).optional(),
  assessmentId: z.string().min(1).optional(),
  level: z.nativeEnum(QuestionDifficulty).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  status: z.enum(['COMPLETED', 'IN_PROGRESS', 'NOT_ATTEMPTED']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['student', 'studentId', 'course', 'assessment', 'attempts', 'score', 'percentage', 'grade', 'completedOn']).default('student'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: 'Start date must be on or before end date',
  path: ['dateTo'],
});

export const assessmentReportStudentParamsSchema = z.object({
  studentId: z.string().min(1).max(64),
});

export const assessmentReportStudentQuerySchema = z.object({
  assessmentId: z.string().min(1),
});

export type AssessmentReportQuery = z.infer<typeof assessmentReportQuerySchema>;

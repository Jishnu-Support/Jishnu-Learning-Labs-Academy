import { z } from 'zod';

const noteFields = {
  title: z.string().trim().min(1).max(160),
  subject: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(10000),
  courseId: z.string().cuid().nullable().optional(),
};

export const createNoteSchema = z.object(noteFields);
export const updateNoteSchema = z.object(noteFields).partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update',
);

export const notesListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(100).optional(),
  courseId: z.string().cuid().optional(),
});

export const noteParamSchema = z.object({ noteId: z.string().cuid() });

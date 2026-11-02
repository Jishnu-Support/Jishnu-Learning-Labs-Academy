import { z } from 'zod';

export const studentParamSchema = z.object({ studentId: z.string().trim().min(1).max(40) });
export const userParamSchema = z.object({ userId: z.string().trim().min(1).max(64) });
export const decisionSchema = z.object({ reason: z.string().trim().min(1, 'Provide a rejection reason').max(1000) });

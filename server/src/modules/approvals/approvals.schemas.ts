import { z } from 'zod';

export const studentParamSchema = z.object({ studentId: z.string().trim().min(1).max(40) });
export const decisionSchema = z.object({ reason: z.string().trim().max(1000).optional() });

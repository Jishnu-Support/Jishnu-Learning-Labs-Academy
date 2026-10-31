import { z } from 'zod';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
export const registrationSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password,
});
export const studentLoginSchema = z.object({ studentId: z.string().trim().min(1), password: z.string().min(1) });
export const portalLoginSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(1) });

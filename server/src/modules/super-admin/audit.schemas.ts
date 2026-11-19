import { Role } from '@prisma/client';
import { z } from 'zod';

export const auditSessionQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  user: z.string().trim().max(120).optional(),
  role: z.nativeEnum(Role).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: 'Start date must be on or before end date',
  path: ['to'],
});

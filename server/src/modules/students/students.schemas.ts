import { AccountStatus } from '@prisma/client';
import { z } from 'zod';

export const studentListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const studentParamSchema = z.object({ studentId: z.string().trim().min(1).max(40) });

import { AccountStatus } from '@prisma/client';
import { z } from 'zod';
import { emailSchema, phoneSchema } from '../../utils/validation-schemas.js';

const staffFields = {
  staffId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: emailSchema,
  joiningDate: z.string().date(),
};

export const createStaffSchema = z.object({
  ...staffFields,
  temporaryPassword: z.string().min(8).max(128),
});

export const updateStaffSchema = z.object(staffFields).partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update',
);

export const staffListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const staffParamSchema = z.object({ userId: z.string().cuid() });

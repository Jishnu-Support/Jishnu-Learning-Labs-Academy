import { z } from 'zod';
import { emailSchema, phoneSchema } from '../../utils/validation-schemas.js';

export const organizationRegistrationSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  organizationHeadName: z.string().trim().min(2).max(120),
  contactNumber: phoneSchema,
  email: emailSchema,
  address: z.string().trim().min(2).max(240),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().max(120).optional(),
  website: z.string().trim().url().max(255).optional().or(z.literal('')).transform((value) => value || undefined),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const organizationParamSchema = z.object({
  organizationId: z.string().trim().min(1).max(64),
});

export const organizationSearchSchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export const rejectionSchema = z.object({
  reason: z.string().trim().min(1, 'Provide a rejection reason').max(1000),
});

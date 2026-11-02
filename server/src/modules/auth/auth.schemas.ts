import { z } from 'zod';
import { emailSchema, organizationCodeSchema, phoneSchema } from '../../utils/validation-schemas.js';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const studentRegistrationSchema = z.object({
  organizationCode: organizationCodeSchema,
  studentId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
  password,
});

export const instructorRegistrationSchema = z.object({
  organizationCode: organizationCodeSchema,
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
  password,
});

export const staffRegistrationSchema = z.object({
  organizationCode: organizationCodeSchema,
  staffId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
  password,
});

export const studentLoginSchema = z.object({
  organizationCode: organizationCodeSchema,
  studentId: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(128),
});

export const portalLoginSchema = z.object({
  organizationCode: organizationCodeSchema,
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const staffLoginSchema = z.object({
  organizationCode: organizationCodeSchema,
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const superAdminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

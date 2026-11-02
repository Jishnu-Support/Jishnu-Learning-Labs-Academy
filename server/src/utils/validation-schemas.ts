import { z } from 'zod';

export const emailSchema = z.string().trim().email('Enter a valid email').max(254).transform((value) => value.toLowerCase());

export const organizationCodeSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/, 'Enter a valid organization code')
  .transform((value) => value.toLowerCase());

export const phoneSchema = z.string().trim().min(7).max(25).refine((value) => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+()\d\s-]+$/.test(value);
}, 'Enter a valid contact number');

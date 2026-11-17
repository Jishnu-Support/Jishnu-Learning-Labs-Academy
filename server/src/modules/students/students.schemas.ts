import { AccountStatus } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { phoneSchema } from '../../utils/validation-schemas.js';

export const studentListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const studentParamSchema = z.object({ studentId: z.string().trim().min(1).max(40) });
const educationLevels = ['SCHOOL', 'DIPLOMA', 'UG', 'PG', 'OTHER'] as const;
const aadhaarSchema = z.string()
  .regex(/^[2-9]\d{11}$/, 'Enter a valid 12-digit Aadhaar number')
  .refine((value) => {
    const multiplication = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
      [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
      [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
      [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
      [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
      [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ];
    const permutation = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
      [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
      [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
      [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
      [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
    ];
    let checksum = 0;
    for (let index = 0; index < value.length; index += 1) {
      const digit = Number(value[value.length - 1 - index]);
      const permutedDigit = permutation[index % 8]?.[digit];
      if (permutedDigit === undefined) return false;
      const transformedDigit = multiplication[checksum]?.[permutedDigit];
      if (transformedDigit === undefined) return false;
      checksum = transformedDigit;
    }
    return checksum === 0;
  }, 'Aadhaar checksum is invalid');

export const studentProfileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.nullable().optional(),
  fatherName: z.string().trim().max(120).nullable().optional(),
  motherName: z.string().trim().max(120).nullable().optional(),
  currentEducation: z.string().trim().max(160).nullable().optional(),
  educationLevel: z.enum(educationLevels).nullable().optional(),
  educationYear: z.string().trim().max(80).nullable().optional(),
  currentCourse: z.string().trim().max(160).nullable().optional(),
  institutionName: z.string().trim().max(200).nullable().optional(),
  piiConsent: z.boolean().optional(),
  aadhaarNumber: aadhaarSchema.nullable().optional(),
  apaarId: z.string().regex(/^\d{12}$/, 'Enter a valid 12-digit APAAR ID').nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .refine((value) => {
    if (value.aadhaarNumber && !env.ENABLE_AADHAAR_FIELD) return false;
    return true;
  }, { path: ['aadhaarNumber'], message: 'Aadhaar collection is disabled for this deployment' })
  .refine((value) => {
    const hasIdentifier = Boolean(value.aadhaarNumber || value.apaarId);
    return !hasIdentifier || value.piiConsent === true;
  }, { path: ['piiConsent'], message: 'Consent is required before saving identification numbers' });

const sensitiveRevealFields = z.object({
  field: z.enum(['aadhaar', 'apaar']),
  password: z.string().min(1).max(128),
});
export const revealMySensitiveSchema = sensitiveRevealFields;
export const revealStudentSensitiveSchema = sensitiveRevealFields.extend({
  reason: z.string().trim().min(8, 'Provide a reason of at least 8 characters').max(500),
});

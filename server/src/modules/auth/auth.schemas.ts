import { z } from 'zod';
import { RegistrationPaymentMethod } from '@prisma/client';
import { emailSchema, organizationCodeSchema } from '../../utils/validation-schemas.js';
import { env } from '../../config/env.js';
import { aadhaarNumberSchema, apaarIdSchema } from '../students/students.schemas.js';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const registrationPhone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const optionalAadhaar = z.union([z.literal(''), aadhaarNumberSchema]).optional().transform((value) => value || undefined);
const optionalApaarId = z.union([z.literal(''), apaarIdSchema]).optional().transform((value) => value || undefined);
const formBoolean = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());
const registrationFields = {
  organizationCode: organizationCodeSchema,
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: emailSchema,
  phone: registrationPhone,
  password,
  fatherName: z.string().trim().min(2, 'Enter your father’s name').max(120),
  motherName: z.string().trim().min(2, 'Enter your mother’s name').max(120),
  aadhaarNumber: optionalAadhaar,
  apaarId: optionalApaarId,
  interestedCourseId: z.string().cuid('Choose an available course'),
  piiConsent: formBoolean.optional().default(false),
  termsAccepted: formBoolean.refine((value) => value, 'Accept the Terms & Conditions to continue'),
  paymentMethod: z.nativeEnum(RegistrationPaymentMethod),
  transactionReference: z.string().trim().min(1, 'Enter the transaction or reference number').max(120),
  reportedPaid: formBoolean.refine((value) => value, 'Confirm that you have paid to continue'),
};

function validateRegistrationPrivacy(
  value: { aadhaarNumber?: string; apaarId?: string; piiConsent: boolean },
  context: z.RefinementCtx,
) {
  if (value.aadhaarNumber && !env.ENABLE_AADHAAR_FIELD) {
    context.addIssue({ code: 'custom', path: ['aadhaarNumber'], message: 'Aadhaar collection is disabled for this deployment' });
  }
  if ((value.aadhaarNumber || value.apaarId) && !env.PII_ENCRYPTION_KEY) {
    context.addIssue({ code: 'custom', path: ['piiConsent'], message: 'Identity collection is currently unavailable' });
  }
  if ((value.aadhaarNumber || value.apaarId) && !value.piiConsent) {
    context.addIssue({ code: 'custom', path: ['piiConsent'], message: 'Consent is required before saving identification numbers' });
  }
}

export const registrationOptionsQuerySchema = z.object({
  organizationCode: organizationCodeSchema,
  role: z.enum(['STUDENT', 'TUTOR']).default('STUDENT'),
});

export const registrationStatusSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const studentRegistrationSchema = z.object({
  ...registrationFields,
  studentId: z.string().trim().min(1).max(40),
}).superRefine(validateRegistrationPrivacy);

export const tutorRegistrationSchema = z.object({
  ...registrationFields,
  tutorId: z.string().trim().regex(/^TUT-[A-Z0-9-]+$/i, 'Use a Tutor ID starting with TUT-').max(40),
}).superRefine(validateRegistrationPrivacy);

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

export const tutorLoginSchema = z.object({
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

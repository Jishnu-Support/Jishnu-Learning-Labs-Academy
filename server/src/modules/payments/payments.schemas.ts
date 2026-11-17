import { PaymentStatus, SubscriptionPeriod, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';

export const checkoutSchema = z.object({
  planId: z.string().trim().min(1).max(64),
  periodsCount: z.number().int().min(1).max(12).default(1),
  pin: z.string().regex(/^\d{6}$/).optional(),
});

export const paymentIdSchema = z.object({ paymentId: z.string().trim().min(1).max(64) });
export const planIdSchema = z.object({ planId: z.string().trim().min(1).max(64) });
export const tutorIdSchema = z.object({ tutorId: z.string().trim().min(1).max(64) });
export const subscriptionIdSchema = z.object({ subscriptionId: z.string().trim().min(1).max(64) });
export const organizationIdSchema = z.object({ organizationId: z.string().trim().min(1).max(64) });

export const paymentFiltersSchema = z.object({
  organizationId: z.string().trim().min(1).max(64).optional(),
  tutorId: z.string().trim().min(1).max(64).optional(),
  courseId: z.string().trim().min(1).max(64).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ['to'],
  message: 'End date must be on or after start date',
});

export const tutorPlanPriceSchema = z.object({
  courseId: z.string().trim().min(1).max(64),
  period: z.nativeEnum(SubscriptionPeriod),
  price: z.number().positive().max(999_999_999.99),
});

export const planPriceOverrideSchema = z.object({
  price: z.number().positive().max(999_999_999.99),
  reason: z.string().trim().min(3).max(500),
});

export const organizationPaymentSettingsSchema = z.object({
  paymentsEnabled: z.boolean(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/),
  minimumMonthlyFee: z.number().nonnegative().nullable(),
  maximumMonthlyFee: z.number().positive().nullable(),
  minimumQuarterlyFee: z.number().nonnegative().nullable(),
  maximumQuarterlyFee: z.number().positive().nullable(),
  minimumYearlyFee: z.number().nonnegative().nullable(),
  maximumYearlyFee: z.number().positive().nullable(),
  invoiceName: z.string().trim().max(160).nullable(),
  invoiceAddress: z.string().trim().max(500).nullable(),
  invoiceTaxId: z.string().trim().max(80).nullable(),
}).superRefine((value, context) => {
  for (const period of ['Monthly', 'Quarterly', 'Yearly'] as const) {
    const min = value[`minimum${period}Fee`];
    const max = value[`maximum${period}Fee`];
    if (min !== null && max !== null && min > max) {
      context.addIssue({ code: 'custom', path: [`maximum${period}Fee`], message: `Maximum ${period.toLowerCase()} fee must be at least the minimum` });
    }
  }
});

export const subscriptionStatusSchema = z.object({
  status: z.enum([SubscriptionStatus.ACTIVE, SubscriptionStatus.INACTIVE]),
  reason: z.string().trim().min(3).max(500),
});

export const refundSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const feeAcceptanceSchema = z.object({ acceptsNewFees: z.boolean() });
export const organizationPaymentsToggleSchema = z.object({ paymentsEnabled: z.boolean() });

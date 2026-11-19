import { z } from 'zod';

export const createOpportunitySchema = z.object({
  title: z.string().trim().min(3).max(160),
  company: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(5000),
  externalUrl: z.string().trim().url().refine((value) => new URL(value).protocol === 'https:', 'Use a secure HTTPS job link'),
  closesAt: z.iso.datetime().optional(),
});

export const opportunityParamsSchema = z.object({ jobOpeningId: z.string().cuid() });
export const applicationParamsSchema = z.object({ applicationId: z.string().cuid() });

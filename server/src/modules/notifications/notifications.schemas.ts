import { NotificationType } from '@prisma/client';
import { z } from 'zod';

export const notificationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  type: z.nativeEnum(NotificationType).optional(),
});

export const notificationParamSchema = z.object({ notificationId: z.string().cuid() });

export const notificationPreferenceSchema = z.object({
  preferences: z.array(z.object({
    category: z.enum(['CONTENT', 'SESSIONS', 'ASSESSMENTS', 'ACCOUNT', 'REQUESTS', 'PAYMENTS', 'SUBSCRIPTIONS', 'CERTIFICATES', 'ATTENDANCE', 'CLASSES', 'PAYOUTS', 'SYSTEM']),
    enabled: z.boolean(),
  })).max(12),
});

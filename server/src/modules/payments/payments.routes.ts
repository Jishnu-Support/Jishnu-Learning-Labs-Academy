import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import * as controller from './payments.controller.js';
import {
  checkoutSchema, feeAcceptanceSchema, organizationIdSchema, organizationPaymentSettingsSchema,
  organizationPaymentsToggleSchema, paymentFiltersSchema, paymentIdSchema, planIdSchema,
  planPriceOverrideSchema, refundSchema, subscriptionIdSchema, subscriptionStatusSchema,
  registrationPaymentFiltersSchema, tutorIdSchema, tutorPlanPriceSchema,
} from './payments.schemas.js';

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);
paymentsRouter.get('/student', requireOrganization, requireRoles(Role.STUDENT), controller.overview);
paymentsRouter.post('/student/checkout', requireOrganization, requireRoles(Role.STUDENT), validateBody(checkoutSchema), controller.checkout);
paymentsRouter.get('/student/:paymentId/receipt', requireOrganization, requireRoles(Role.STUDENT), validateParams(paymentIdSchema), controller.receipt);

paymentsRouter.get(
  '/management/export.csv',
  requireRoles(Role.TUTOR, Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateQuery(paymentFiltersSchema),
  controller.managementExport,
);
paymentsRouter.get(
  '/management',
  requireRoles(Role.TUTOR, Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateQuery(paymentFiltersSchema),
  controller.managementData,
);
paymentsRouter.get(
  '/registration',
  requireRoles(Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateQuery(registrationPaymentFiltersSchema),
  controller.registrationPayments,
);
paymentsRouter.put(
  '/registration/:paymentId/confirm',
  requireRoles(Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateParams(paymentIdSchema),
  controller.confirmRegistrationPayment,
);
paymentsRouter.get(
  '/registration/:paymentId/receipt',
  requireRoles(Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateParams(paymentIdSchema),
  controller.registrationPaymentReceipt,
);
paymentsRouter.put(
  '/registration/:paymentId/refund',
  requireOrganization,
  requireRoles(Role.ORG_ADMIN),
  validateParams(paymentIdSchema),
  validateBody(refundSchema),
  controller.refundRegistrationPayment,
);
paymentsRouter.put('/tutor/plans', requireOrganization, requireRoles(Role.TUTOR), validateBody(tutorPlanPriceSchema), controller.setTutorPlanPrice);
paymentsRouter.put(
  '/organization/plans/:planId/price',
  requireOrganization,
  requireRoles(Role.ORG_ADMIN),
  validateParams(planIdSchema),
  validateBody(planPriceOverrideSchema),
  controller.overridePlanPrice,
);
paymentsRouter.put(
  '/organization/settings',
  requireOrganization,
  requireRoles(Role.ORG_ADMIN),
  validateBody(organizationPaymentSettingsSchema),
  controller.updateOrganizationSettings,
);
paymentsRouter.put(
  '/organization/tutors/:tutorId/fee-acceptance',
  requireOrganization,
  requireRoles(Role.ORG_ADMIN),
  validateParams(tutorIdSchema),
  validateBody(feeAcceptanceSchema),
  controller.toggleTutorFeeAcceptance,
);
paymentsRouter.put(
  '/organization/payments/:paymentId/refund',
  requireOrganization,
  requireRoles(Role.ORG_ADMIN),
  validateParams(paymentIdSchema),
  validateBody(refundSchema),
  controller.refund,
);
paymentsRouter.put(
  '/subscriptions/:subscriptionId/status',
  requireRoles(Role.ORG_ADMIN, Role.SUPER_ADMIN),
  validateParams(subscriptionIdSchema),
  validateBody(subscriptionStatusSchema),
  controller.toggleSubscription,
);
paymentsRouter.put(
  '/platform/organizations/:organizationId/payments',
  requireRoles(Role.SUPER_ADMIN),
  validateParams(organizationIdSchema),
  validateBody(organizationPaymentsToggleSchema),
  controller.toggleOrganizationPayments,
);

import type { Request, RequestHandler } from 'express';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../../utils/http-error.js';
import * as service from './payments.service.js';
import * as management from './payments-management.service.js';
import {
  checkoutSchema, feeAcceptanceSchema, organizationPaymentSettingsSchema, organizationPaymentsToggleSchema,
  paymentFiltersSchema, planPriceOverrideSchema, refundSchema, registrationPaymentFiltersSchema,
  subscriptionStatusSchema, tutorPlanPriceSchema,
} from './payments.schemas.js';

function actor(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Authentication required');
  return { organizationId: req.auth.organizationId, userId: req.auth.userId, role: req.auth.role };
}

export const overview: RequestHandler = async (req, res) => {
  res.json({ data: await service.studentPaymentOverview(actor(req)) });
};

export const checkout: RequestHandler = async (req, res) => {
  const input = checkoutSchema.parse(req.body);
  res.status(201).json({ data: await service.checkout(actor(req), input) });
};

export const receipt: RequestHandler = async (req, res, next) => {
  try {
    const paymentId = req.params.paymentId;
    if (typeof paymentId !== 'string') throw new HttpError(400, 'Invalid payment ID');
    const result = await service.paymentReceipt(actor(req), paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.receiptNumber}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.file);
  } catch (error) {
    next(error);
  }
};

function filters(req: Request) {
  return paymentFiltersSchema.parse(req.query);
}

export const managementData: RequestHandler = async (req, res) => {
  res.json({ data: await management.paymentManagementData(actor(req), filters(req)) });
};

export const managementExport: RequestHandler = async (req, res) => {
  const csv = await management.exportPaymentManagement(actor(req), filters(req));
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="course-payments.csv"');
  res.send(csv);
};

export const setTutorPlanPrice: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await management.setTutorPlanPrice(actor(req), tutorPlanPriceSchema.parse(req.body)) });
};

export const overridePlanPrice: RequestHandler = async (req, res) => {
  const planId = req.params.planId;
  if (typeof planId !== 'string') throw new HttpError(400, 'Invalid course fee plan ID');
  res.json({ data: await management.overridePlanPrice(actor(req), planId, planPriceOverrideSchema.parse(req.body)) });
};

export const updateOrganizationSettings: RequestHandler = async (req, res) => {
  res.json({ data: await management.updateOrganizationPaymentSettings(actor(req), organizationPaymentSettingsSchema.parse(req.body)) });
};

export const toggleTutorFeeAcceptance: RequestHandler = async (req, res) => {
  const tutorId = req.params.tutorId;
  if (typeof tutorId !== 'string') throw new HttpError(400, 'Invalid Tutor ID');
  res.json({ data: await management.setTutorAcceptingFees(actor(req), tutorId, feeAcceptanceSchema.parse(req.body).acceptsNewFees) });
};

export const toggleOrganizationPayments: RequestHandler = async (req, res) => {
  const organizationId = req.params.organizationId;
  if (typeof organizationId !== 'string') throw new HttpError(400, 'Invalid organization ID');
  const { paymentsEnabled } = organizationPaymentsToggleSchema.parse(req.body);
  res.json({ data: await management.setOrganizationPaymentsEnabled(actor(req), organizationId, paymentsEnabled) });
};

export const toggleSubscription: RequestHandler = async (req, res) => {
  const subscriptionId = req.params.subscriptionId;
  if (typeof subscriptionId !== 'string') throw new HttpError(400, 'Invalid subscription ID');
  res.json({ data: await management.setSubscriptionStatus(actor(req), subscriptionId, subscriptionStatusSchema.parse(req.body)) });
};

export const refund: RequestHandler = async (req, res) => {
  const paymentId = req.params.paymentId;
  if (typeof paymentId !== 'string') throw new HttpError(400, 'Invalid payment ID');
  res.json({ data: await management.refundPayment(actor(req), paymentId, refundSchema.parse(req.body).reason) });
};

export const registrationPayments: RequestHandler = async (req, res) => {
  res.json({ data: { payments: await management.listRegistrationPayments(actor(req), registrationPaymentFiltersSchema.parse(req.query)) } });
};

export const confirmRegistrationPayment: RequestHandler = async (req, res) => {
  const paymentId = req.params.paymentId;
  if (typeof paymentId !== 'string') throw new HttpError(400, 'Invalid registration payment ID');
  res.json({ data: await management.confirmRegistrationPayment(actor(req), paymentId) });
};

export const refundRegistrationPayment: RequestHandler = async (req, res) => {
  const paymentId = req.params.paymentId;
  if (typeof paymentId !== 'string') throw new HttpError(400, 'Invalid registration payment ID');
  res.json({
    data: await management.refundRegistrationPayment(actor(req), paymentId, refundSchema.parse(req.body).reason),
  });
};

export const registrationPaymentReceipt: RequestHandler = async (req, res) => {
  const paymentId = req.params.paymentId;
  if (typeof paymentId !== 'string') throw new HttpError(400, 'Invalid registration payment ID');
  const user = actor(req);
  const result = await management.registrationPaymentReceipt(user, paymentId);
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename.replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await pipeline(result.stream, res);
};

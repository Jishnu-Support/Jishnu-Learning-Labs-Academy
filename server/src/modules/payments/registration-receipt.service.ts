import { basename, extname } from 'node:path';
import type { Express } from 'express';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { localDiskStorage } from '../notes/storage.service.js';

const receiptTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

export async function saveRegistrationReceipt(file: Express.Multer.File | undefined) {
  if (!file) return null;
  const extension = extname(file.originalname).toLowerCase();
  const expectedType = receiptTypes.get(extension);
  if (!expectedType || file.mimetype.toLowerCase() !== expectedType) {
    throw new HttpError(400, 'Receipt must be a PDF, PNG, JPG, or WEBP file with a matching file type');
  }
  const originalName = basename(file.originalname.replaceAll('\\', '/')).replace(/[\r\n"]/g, '').slice(0, 255);
  if (!originalName) throw new HttpError(400, 'Receipt must have a valid filename');
  const storageKey = await localDiskStorage.save(file.buffer, extension);
  return { storageKey, originalName };
}

export async function removeRegistrationReceipt(storageKey: string | null | undefined) {
  if (storageKey) await localDiskStorage.remove(storageKey);
}

export async function openRegistrationReceipt(input: {
  paymentId: string;
  organizationId?: string;
  actorId: string;
}) {
  const payment = await prisma.registrationPayment.findFirst({
    where: {
      id: input.paymentId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      receiptStorageKey: { not: null },
    },
    select: { id: true, organizationId: true, receiptStorageKey: true, receiptOriginalName: true },
  });
  if (!payment?.receiptStorageKey) throw new HttpError(404, 'Registration receipt not found');
  await prisma.auditLog.create({
    data: {
      organizationId: payment.organizationId,
      actorId: input.actorId,
      action: 'REGISTRATION_PAYMENT_RECEIPT_ACCESSED',
      targetType: 'RegistrationPayment',
      targetId: payment.id,
      metadata: {},
    },
  });
  const file = await localDiskStorage.open(payment.receiptStorageKey);
  return {
    ...file,
    filename: payment.receiptOriginalName ?? 'registration-receipt',
    mimeType: receiptTypes.get(extname(payment.receiptOriginalName ?? '').toLowerCase()) ?? 'application/octet-stream',
  };
}

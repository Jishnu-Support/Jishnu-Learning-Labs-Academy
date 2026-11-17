import { randomBytes } from 'node:crypto';
import {
  EnrollmentStatus, NotificationType, PaymentStatus, Role, SubscriptionPeriod, SubscriptionStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyAfterCommit, notifyUsers } from '../notifications/notifications.service.js';
import { createPaymentProvider } from './payment.provider.js';
import { createReceiptPdf } from './receipt-pdf.js';

type PaymentActor = { organizationId: string | null; userId: string; role: Role };

function organizationId(actor: PaymentActor) {
  if (!actor.organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return actor.organizationId;
}

function requireStudent(actor: PaymentActor) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Only students can manage their course fees');
  return organizationId(actor);
}

function addPeriod(start: Date, period: SubscriptionPeriod, count: number) {
  const months = period === SubscriptionPeriod.MONTHLY ? 1 : period === SubscriptionPeriod.QUARTERLY ? 3 : 12;
  const targetMonth = start.getMonth() + months * count;
  const result = new Date(start);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(targetMonth);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function newReceiptNumber(organization: string) {
  return `JLL-${organization.slice(-5).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function studentPaymentOverview(actor: PaymentActor) {
  const tenantId = requireStudent(actor);
  const organization = await prisma.organization.findFirst({
    where: { id: tenantId },
    select: { paymentsEnabled: true, currency: true, name: true, invoiceName: true, invoiceAddress: true, invoiceTaxId: true },
  });
  if (!organization) throw new HttpError(404, 'Organization not found');
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationId: tenantId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
    select: {
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          enrollments: {
            where: { organizationId: tenantId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE },
            select: { selectedTutorId: true, pendingTutorId: true },
            take: 1,
          },
          instructors: {
            select: {
              instructor: { select: { id: true, name: true, tutorProfile: { select: { bio: true } } } },
            },
            orderBy: { instructor: { name: 'asc' } },
          },
        },
      },
    },
    orderBy: { course: { title: 'asc' } },
  });
  const courseIds = enrollments.map(({ course }) => course.id);
  const [plans, subscriptions, payments] = await Promise.all([
    prisma.tutorCoursePlan.findMany({
      where: { organizationId: tenantId, courseId: { in: courseIds }, isActive: true, tutor: { tutorProfile: { acceptsNewFees: true } } },
      include: { tutor: { select: { id: true, name: true, tutorProfile: { select: { tutorId: true, bio: true, acceptsNewFees: true } } } } },
      orderBy: [{ course: { title: 'asc' } }, { period: 'asc' }],
    }),
    prisma.subscription.findMany({
      where: { organizationId: tenantId, studentId: actor.userId },
      include: {
        course: { select: { id: true, code: true, title: true } },
        tutor: { select: { id: true, name: true, tutorProfile: { select: { tutorId: true } } } },
        plan: { select: { period: true, price: true } },
      },
      orderBy: { endsAt: 'desc' },
    }),
    prisma.payment.findMany({
      where: { organizationId: tenantId, studentId: actor.userId },
      include: {
        course: { select: { id: true, code: true, title: true } },
        tutor: { select: { id: true, name: true, tutorProfile: { select: { tutorId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const now = new Date();
  return {
    paymentsEnabled: organization.paymentsEnabled,
    demoMode: createPaymentProvider().kind === 'MOCK',
    currency: organization.currency,
    invoice: { name: organization.invoiceName ?? organization.name, address: organization.invoiceAddress, taxId: organization.invoiceTaxId },
    courses: enrollments.map(({ course }) => ({
      ...course,
      tutors: course.instructors.map(({ instructor }) => instructor),
      plans: plans.filter((plan) => {
        if (plan.courseId !== course.id) return false;
        const enrollment = course.enrollments[0];
        return !enrollment?.selectedTutorId
          || plan.tutorId === enrollment.selectedTutorId
          || plan.tutorId === enrollment.pendingTutorId;
      }).map((plan) => ({
        id: plan.id,
        period: plan.period,
        price: plan.price.toNumber(),
        tutor: {
          id: plan.tutor.id,
          name: plan.tutor.name,
          tutorId: plan.tutor.tutorProfile?.tutorId ?? '',
          bio: plan.tutor.tutorProfile?.bio ?? '',
          acceptsNewFees: plan.tutor.tutorProfile?.acceptsNewFees ?? false,
        },
      })),
    })),
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      displayStatus: subscription.status === SubscriptionStatus.ACTIVE && subscription.endsAt <= now
        ? SubscriptionStatus.EXPIRED
        : subscription.status,
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
      periodsPaid: subscription.periodsPaid,
      daysLeft: Math.max(0, Math.ceil((subscription.endsAt.getTime() - now.getTime()) / 86_400_000)),
      course: subscription.course,
      tutor: {
        id: subscription.tutor.id,
        name: subscription.tutor.name,
        tutorProfile: subscription.tutor.tutorProfile,
      },
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      planId: payment.planId,
      status: payment.status,
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      createdAt: payment.createdAt,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      periodsCount: payment.periodsCount,
      receiptNumber: payment.receiptNumber,
      course: payment.course,
      tutor: payment.tutor,
      receiptAvailable: payment.status === PaymentStatus.PAID && Boolean(payment.receiptNumber),
    })),
  };
}

export async function checkout(actor: PaymentActor, input: { planId: string; periodsCount: number; pin?: string }) {
  const tenantId = requireStudent(actor);
  const [organization, plan] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: tenantId },
      select: { id: true, code: true, paymentsEnabled: true, currency: true },
    }),
    prisma.tutorCoursePlan.findFirst({
      where: { id: input.planId, organizationId: tenantId, isActive: true },
      include: {
        course: { select: { id: true, title: true } },
        tutor: { select: { id: true, name: true, tutorProfile: { select: { acceptsNewFees: true } } } },
      },
    }),
  ]);
  if (!organization) throw new HttpError(404, 'Organization not found');
  if (!organization.paymentsEnabled) throw new HttpError(409, 'Course fee payments are not enabled for this organization');
  if (!plan) throw new HttpError(404, 'Active course fee plan not found');
  if (!plan.tutor.tutorProfile?.acceptsNewFees) throw new HttpError(409, 'This Tutor is not accepting new course fee payments');
  if (createPaymentProvider().kind === 'MOCK' && input.pin !== '123456' && input.pin !== '000000') {
    throw new HttpError(400, 'Enter the sample demo PIN shown on the checkout screen');
  }
  const [enrollment, assignment] = await Promise.all([
    prisma.enrollment.findFirst({
      where: { organizationId: tenantId, studentId: actor.userId, courseId: plan.courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true, selectedTutorId: true, pendingTutorId: true },
    }),
    prisma.courseInstructor.findFirst({
      where: { organizationId: tenantId, courseId: plan.courseId, instructorId: plan.tutorId },
      select: { courseId: true },
    }),
  ]);
  if (!enrollment || !assignment) throw new HttpError(403, 'This course fee plan is not available to your account');
  if (enrollment.selectedTutorId && plan.tutorId !== enrollment.selectedTutorId && plan.tutorId !== enrollment.pendingTutorId) {
    throw new HttpError(403, 'Choose the selected Tutor’s fee plan for this course');
  }

  const amount = plan.price.mul(input.periodsCount);
  const receiptNumber = newReceiptNumber(organization.code ?? organization.id);
  const provider = createPaymentProvider();
  const providerOrderId = await provider.createOrder({
    amountMinor: amount.mul(100).toNumber(),
    currency: organization.currency,
    receipt: receiptNumber,
  });
  const subscription = await prisma.subscription.findUnique({
    where: {
      organizationId_studentId_tutorId_courseId: {
        organizationId: tenantId,
        studentId: actor.userId,
        tutorId: plan.tutorId,
        courseId: plan.courseId,
      },
    },
    select: { id: true, status: true, startsAt: true, endsAt: true, periodsPaid: true },
  });
  const now = new Date();
  const periodStart = subscription?.status === SubscriptionStatus.ACTIVE && subscription.endsAt > now
    ? subscription.endsAt
    : now;
  const periodEnd = addPeriod(periodStart, plan.period, input.periodsCount);
  const payment = await prisma.payment.create({
    data: {
      organizationId: tenantId,
      studentId: actor.userId,
      tutorId: plan.tutorId,
      courseId: plan.courseId,
      planId: plan.id,
      subscriptionId: subscription?.id ?? null,
      amount,
      currency: organization.currency,
      provider: provider.kind,
      providerOrderId,
      status: PaymentStatus.CREATED,
      periodStart,
      periodEnd,
      periodsCount: input.periodsCount,
      receiptNumber,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: tenantId,
      actorId: actor.userId,
      action: 'PAYMENT_CREATED',
      targetType: 'Payment',
      targetId: payment.id,
      metadata: { provider: provider.kind, planId: plan.id, periodsCount: input.periodsCount },
    },
  });

  const result = await provider.completeOrder({ orderId: providerOrderId, pin: input.pin });
  const updatedPayment = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: result.status, providerPaymentId: result.paymentId },
    });
    if (result.status === PaymentStatus.PAID) {
      if (enrollment.pendingTutorId === plan.tutorId) {
        await tx.enrollment.updateMany({
          where: { id: enrollment.id, organizationId: tenantId, pendingTutorId: plan.tutorId },
          data: { selectedTutorId: plan.tutorId, pendingTutorId: null },
        });
        await tx.auditLog.create({
          data: {
            organizationId: tenantId,
            actorId: actor.userId,
            action: 'STUDENT_TUTOR_CHANGE_EFFECTIVE',
            targetType: 'Enrollment',
            targetId: enrollment.id,
            metadata: { courseId: plan.courseId, tutorId: plan.tutorId, reason: 'renewal-payment' },
          },
        });
      } else if (!enrollment.selectedTutorId) {
        await tx.enrollment.updateMany({
          where: { id: enrollment.id, organizationId: tenantId, selectedTutorId: null },
          data: { selectedTutorId: plan.tutorId },
        });
      }
      const savedSubscription = await tx.subscription.upsert({
        where: {
          organizationId_studentId_tutorId_courseId: {
            organizationId: tenantId,
            studentId: actor.userId,
            tutorId: plan.tutorId,
            courseId: plan.courseId,
          },
        },
        create: {
          organizationId: tenantId,
          studentId: actor.userId,
          tutorId: plan.tutorId,
          courseId: plan.courseId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: periodStart,
          endsAt: periodEnd,
          periodsPaid: input.periodsCount,
        },
        update: {
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: subscription?.status === SubscriptionStatus.ACTIVE && subscription.endsAt > now
            ? subscription.startsAt
            : periodStart,
          endsAt: periodEnd,
          periodsPaid: { increment: input.periodsCount },
          deactivatedBy: null,
          deactivationReason: null,
        },
        select: { id: true },
      });
      await tx.payment.update({ where: { id: payment.id }, data: { subscriptionId: savedSubscription.id } });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId: actor.userId,
        action: result.status === PaymentStatus.PAID ? 'PAYMENT_PAID' : result.status === PaymentStatus.FAILED ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING',
        targetType: 'Payment',
        targetId: payment.id,
        metadata: { provider: provider.kind, courseId: plan.courseId, tutorId: plan.tutorId },
      },
    });
    return updated;
  });

  if (result.status === PaymentStatus.PAID) {
    await notifyAfterCommit(async () => {
      await Promise.all([
        notifyUsers(tenantId, [actor.userId], {
          type: NotificationType.PAYMENT_STATUS,
          courseId: plan.courseId,
          title: 'Course fee payment successful',
          body: `Your payment for ${plan.course.title} is confirmed. Receipt ${receiptNumber}.`,
          link: '/student/payments',
          dedupeKey: `payment:${payment.id}:student`,
        }),
        notifyUsers(tenantId, [plan.tutorId], {
          type: NotificationType.PAYMENT_STATUS,
          courseId: plan.courseId,
          title: 'Course fee payment received',
          body: `A student payment for ${plan.course.title} has been confirmed.`,
          link: '/tutor',
          dedupeKey: `payment:${payment.id}:tutor`,
        }),
      ]);
    }, 'Course fee payment notifications');
  }
  const savedSubscription = result.status === PaymentStatus.PAID
    ? await prisma.subscription.findUnique({
      where: {
        organizationId_studentId_tutorId_courseId: {
          organizationId: tenantId, studentId: actor.userId, tutorId: plan.tutorId, courseId: plan.courseId,
        },
      },
      select: { id: true, status: true, startsAt: true, endsAt: true, periodsPaid: true },
    })
    : null;
  return {
    payment: {
      id: updatedPayment.id,
      status: updatedPayment.status,
      amount: updatedPayment.amount.toNumber(),
      currency: updatedPayment.currency,
      createdAt: updatedPayment.createdAt,
      receiptNumber: updatedPayment.receiptNumber,
    },
    course: plan.course,
    tutor: plan.tutor,
    subscription: savedSubscription,
    demoMode: provider.kind === 'MOCK',
  };
}

export async function paymentReceipt(actor: PaymentActor, paymentId: string) {
  const tenantId = requireStudent(actor);
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: tenantId, studentId: actor.userId, status: PaymentStatus.PAID, receiptNumber: { not: null } },
    include: {
      student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
      tutor: { select: { name: true, tutorProfile: { select: { tutorId: true } } } },
      course: { select: { title: true, code: true } },
      organization: { select: { name: true, invoiceName: true, invoiceAddress: true, invoiceTaxId: true } },
    },
  });
  if (!payment || !payment.receiptNumber) throw new HttpError(404, 'Payment receipt not found');
  const file = createReceiptPdf([
    'Jishnu Learning Labs - Fee Payment Receipt',
    `Receipt number: ${payment.receiptNumber}`,
    `Organization: ${payment.organization.invoiceName ?? payment.organization.name}`,
    `Invoice address: ${payment.organization.invoiceAddress ?? 'Not provided'}`,
    `Tax ID: ${payment.organization.invoiceTaxId ?? 'Not provided'}`,
    `Student: ${payment.student.name} (${payment.student.studentProfile?.studentId ?? 'N/A'})`,
    `Tutor: ${payment.tutor.name} (${payment.tutor.tutorProfile?.tutorId ?? 'N/A'})`,
    `Course: ${payment.course.code} - ${payment.course.title}`,
    `Period: ${payment.periodStart.toISOString().slice(0, 10)} to ${payment.periodEnd.toISOString().slice(0, 10)}`,
    `Periods paid: ${payment.periodsCount}`,
    `Amount: ${payment.currency} ${payment.amount.toFixed(2)}`,
    `Paid on: ${payment.createdAt.toISOString()}`,
  ]);
  return { file, receiptNumber: payment.receiptNumber };
}

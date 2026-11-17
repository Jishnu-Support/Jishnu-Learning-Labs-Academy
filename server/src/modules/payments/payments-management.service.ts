import {
  AccountStatus, NotificationType, PaymentStatus, Role, SubscriptionPeriod, SubscriptionStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyAfterCommit, notifyUsers } from '../notifications/notifications.service.js';

type PaymentActor = { organizationId: string | null; userId: string; role: Role };
type PaymentFilters = {
  organizationId?: string;
  tutorId?: string;
  courseId?: string;
  status?: PaymentStatus;
  from?: Date;
  to?: Date;
};

function tenantId(actor: PaymentActor) {
  if (!actor.organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return actor.organizationId;
}

function requireManager(actor: PaymentActor) {
  if (actor.role !== Role.ORG_ADMIN && actor.role !== Role.SUPER_ADMIN) {
    throw new HttpError(403, 'Only organization admins and Super Admin can manage course payments');
  }
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function filteredPaymentWhere(actor: PaymentActor, filters: PaymentFilters) {
  const where: {
    organizationId?: string | { in: string[] };
    tutorId?: string;
    courseId?: string;
    status?: PaymentStatus;
    createdAt?: { gte?: Date; lte?: Date };
  } = {};
  if (actor.role === Role.TUTOR) {
    where.organizationId = tenantId(actor);
    where.tutorId = actor.userId;
    where.status = filters.status ?? PaymentStatus.PAID;
  } else if (actor.role === Role.ORG_ADMIN) {
    where.organizationId = tenantId(actor);
  } else if (filters.organizationId) {
    where.organizationId = filters.organizationId;
  }
  if (filters.tutorId && actor.role !== Role.TUTOR) where.tutorId = filters.tutorId;
  if (filters.courseId) where.courseId = filters.courseId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    const to = filters.to ? new Date(filters.to) : undefined;
    to?.setUTCHours(23, 59, 59, 999);
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  return where;
}

export async function paymentManagementData(actor: PaymentActor, filters: PaymentFilters = {}) {
  if (actor.role !== Role.TUTOR && actor.role !== Role.ORG_ADMIN && actor.role !== Role.SUPER_ADMIN) {
    throw new HttpError(403, 'You do not have permission to view payment management');
  }
  const orgId = actor.role === Role.SUPER_ADMIN ? filters.organizationId : tenantId(actor);
  const orgWhere = orgId ? { organizationId: orgId } : {};
  const paymentWhere = filteredPaymentWhere(actor, filters);
  const subscriptionWhere: {
    organizationId?: string;
    tutorId?: string;
    courseId?: string;
  } = {
    ...(orgId ? { organizationId: orgId } : {}),
    ...(actor.role === Role.TUTOR ? { tutorId: actor.userId } : {}),
    ...(filters.tutorId && actor.role !== Role.TUTOR ? { tutorId: filters.tutorId } : {}),
    ...(filters.courseId ? { courseId: filters.courseId } : {}),
  };
  const [organizations, courses, tutorProfiles, plans, priceHistory, payments, subscriptions, organization] = await Promise.all([
    actor.role === Role.SUPER_ADMIN
      ? prisma.organization.findMany({
        where: filters.organizationId ? { id: filters.organizationId } : {},
        select: { id: true, name: true, code: true, paymentsEnabled: true, currency: true },
        orderBy: { name: 'asc' },
      })
      : Promise.resolve([]),
    prisma.course.findMany({
      where: {
        ...orgWhere,
        ...(actor.role === Role.TUTOR ? { instructors: { some: { instructorId: actor.userId } } } : {}),
      },
      select: { id: true, organizationId: true, code: true, title: true },
      orderBy: { title: 'asc' },
    }),
    prisma.tutorProfile.findMany({
      where: {
        ...orgWhere,
        ...(actor.role === Role.TUTOR ? { organizationId: tenantId(actor), userId: actor.userId } : {}),
        ...(actor.role === Role.ORG_ADMIN ? { organizationId: tenantId(actor) } : {}),
        ...(filters.tutorId && actor.role !== Role.TUTOR ? { userId: filters.tutorId } : {}),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.tutorCoursePlan.findMany({
      where: {
        ...orgWhere,
        ...(actor.role === Role.TUTOR ? { tutorId: actor.userId } : {}),
        ...(filters.tutorId && actor.role !== Role.TUTOR ? { tutorId: filters.tutorId } : {}),
        ...(filters.courseId ? { courseId: filters.courseId } : {}),
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
        tutor: { select: { id: true, name: true, tutorProfile: { select: { tutorId: true, acceptsNewFees: true } } } },
      },
      orderBy: [{ course: { title: 'asc' } }, { period: 'asc' }],
    }),
    prisma.tutorCoursePlanHistory.findMany({
      where: {
        ...orgWhere,
        ...(actor.role === Role.TUTOR ? { plan: { tutorId: actor.userId } } : {}),
        ...(filters.tutorId && actor.role !== Role.TUTOR ? { plan: { tutorId: filters.tutorId } } : {}),
        ...(filters.courseId ? { plan: { courseId: filters.courseId } } : {}),
      },
      include: {
        plan: {
          select: {
            period: true,
            course: { select: { title: true, code: true } },
            tutor: { select: { name: true, tutorProfile: { select: { tutorId: true } } } },
          },
        },
        changedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.payment.findMany({
      where: paymentWhere,
      include: {
        organization: { select: { id: true, name: true, code: true } },
        student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } },
        tutor: { select: { id: true, name: true, tutorProfile: { select: { tutorId: true } } } },
        course: { select: { id: true, code: true, title: true } },
        plan: { select: { period: true } },
        subscription: { select: { id: true, status: true, startsAt: true, endsAt: true, periodsPaid: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.subscription.findMany({
      where: subscriptionWhere,
      select: {
        id: true,
        organizationId: true,
        studentId: true,
        tutorId: true,
        courseId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        periodsPaid: true,
        deactivationReason: true,
        student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
        tutor: { select: { name: true, tutorProfile: { select: { tutorId: true } } } },
        course: { select: { code: true, title: true } },
        organization: { select: { name: true, code: true } },
      },
      orderBy: { endsAt: 'asc' },
    }),
    actor.role === Role.SUPER_ADMIN
      ? Promise.resolve(null)
      : prisma.organization.findFirst({
        where: { id: tenantId(actor) },
        select: {
          id: true, name: true, code: true, paymentsEnabled: true, currency: true,
          minimumMonthlyFee: true, maximumMonthlyFee: true, minimumQuarterlyFee: true,
          maximumQuarterlyFee: true, minimumYearlyFee: true, maximumYearlyFee: true,
          invoiceName: true, invoiceAddress: true, invoiceTaxId: true,
        },
      }),
  ]);
  if (actor.role !== Role.SUPER_ADMIN && !organization) throw new HttpError(404, 'Organization not found');
  if (actor.role === Role.SUPER_ADMIN && filters.organizationId && organizations.length === 0) {
    throw new HttpError(404, 'Organization not found');
  }

  const now = new Date();
  const paidPayments = payments.filter((payment) => payment.status === PaymentStatus.PAID);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthPayments = paidPayments.filter((payment) => payment.createdAt >= monthStart);
  const revenueByPeriod = { MONTHLY: 0, QUARTERLY: 0, YEARLY: 0 };
  for (const payment of paidPayments) revenueByPeriod[payment.plan.period] += payment.amount.toNumber();
  const activeSubscriptions = subscriptions.filter((item) => item.status === SubscriptionStatus.ACTIVE && item.endsAt > now);
  const expiredSubscriptions = subscriptions.filter((item) =>
    item.status === SubscriptionStatus.EXPIRED || (item.status === SubscriptionStatus.ACTIVE && item.endsAt <= now));
  const inactiveSubscriptions = subscriptions.filter((item) => item.status === SubscriptionStatus.INACTIVE);
  const aggregateBy = (key: 'courseId' | 'tutorId' | 'organizationId') => {
    const groups = new Map<string, { amount: number; count: number }>();
    for (const payment of paidPayments) {
      const id = payment[key];
      const group = groups.get(id) ?? { amount: 0, count: 0 };
      group.amount += payment.amount.toNumber();
      group.count += 1;
      groups.set(id, group);
    }
    return groups;
  };
  const courseTotals = aggregateBy('courseId');
  const tutorTotals = aggregateBy('tutorId');
  const organizationTotals = aggregateBy('organizationId');
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const tutorById = new Map(tutorProfiles.map((profile) => [profile.user.id, profile.user.name]));

  return {
    scope: actor.role,
    demoMode: process.env.NODE_ENV !== 'production' && (process.env.PAYMENT_PROVIDER ?? 'MOCK') === 'MOCK',
    organization: organization ? {
      ...organization,
      minimumMonthlyFee: organization.minimumMonthlyFee?.toNumber() ?? null,
      maximumMonthlyFee: organization.maximumMonthlyFee?.toNumber() ?? null,
      minimumQuarterlyFee: organization.minimumQuarterlyFee?.toNumber() ?? null,
      maximumQuarterlyFee: organization.maximumQuarterlyFee?.toNumber() ?? null,
      minimumYearlyFee: organization.minimumYearlyFee?.toNumber() ?? null,
      maximumYearlyFee: organization.maximumYearlyFee?.toNumber() ?? null,
    } : null,
    organizations: organizations.map((item) => ({
      ...item,
      totals: {
        revenue: organizationTotals.get(item.id)?.amount ?? 0,
        payments: organizationTotals.get(item.id)?.count ?? 0,
        activeSubscriptions: subscriptions.filter((subscription) =>
          subscription.organizationId === item.id && subscription.status === SubscriptionStatus.ACTIVE && subscription.endsAt > now).length,
      },
    })),
    summary: {
      revenueThisMonth: monthPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0),
      revenueAllTime: paidPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0),
      revenueByPeriod,
      activeSubscriptions: activeSubscriptions.length,
      expiredSubscriptions: expiredSubscriptions.length,
      inactiveSubscriptions: inactiveSubscriptions.length,
      failedPayments: payments.filter((payment) => payment.status === PaymentStatus.FAILED).length,
      refunds: payments.filter((payment) => payment.status === PaymentStatus.REFUNDED).length,
      pendingRenewals: activeSubscriptions.filter((item) => item.endsAt.getTime() <= now.getTime() + 7 * 86_400_000).length,
      uniquePayingStudents: new Set(paidPayments.map((payment) => payment.studentId)).size,
      newestPayments: payments.slice(0, 5).map((payment) => payment.id),
    },
    courses: courses.map((course) => course),
    tutors: tutorProfiles.map((profile) => ({
      id: profile.user.id, name: profile.user.name, tutorId: profile.tutorId, acceptsNewFees: profile.acceptsNewFees,
    })),
    plans: plans.map((plan) => ({
      id: plan.id,
      organizationId: plan.organizationId,
      tutorId: plan.tutorId,
      courseId: plan.courseId,
      period: plan.period,
      price: plan.price.toNumber(),
      isActive: plan.isActive,
      acceptsNewFees: plan.tutor.tutorProfile?.acceptsNewFees ?? false,
      course: plan.course,
      tutor: { id: plan.tutor.id, name: plan.tutor.name, tutorId: plan.tutor.tutorProfile?.tutorId ?? '' },
    })),
    priceHistory: priceHistory.map((item) => ({
      id: item.id,
      period: item.plan.period,
      previousPrice: item.previousPrice?.toNumber() ?? null,
      newPrice: item.newPrice.toNumber(),
      reason: item.reason,
      createdAt: item.createdAt,
      course: item.plan.course,
      tutor: { ...item.plan.tutor, tutorId: item.plan.tutor.tutorProfile?.tutorId ?? '' },
      changedBy: item.changedBy?.name ?? 'System',
    })),
    byCourse: [...courseTotals].map(([id, totals]) => ({
      course: courseById.get(id) ?? { id, title: id, code: '' }, ...totals,
    })),
    byTutor: [...tutorTotals].map(([id, totals]) => ({
      tutor: {
        id, name: tutorById.get(id) ?? '',
        tutorId: tutorProfiles.find((profile) => profile.user.id === id)?.tutorId ?? '',
      },
      ...totals,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      organization: payment.organization,
      student: { id: payment.student.id, name: payment.student.name, studentId: payment.student.studentProfile?.studentId ?? '' },
      tutor: { id: payment.tutor.id, name: payment.tutor.name, tutorId: payment.tutor.tutorProfile?.tutorId ?? '' },
      course: payment.course,
      period: payment.plan.period,
      subscription: payment.subscription,
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      status: payment.status,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      periodsCount: payment.periodsCount,
      receiptNumber: payment.receiptNumber,
      createdAt: payment.createdAt,
    })),
    subscriptions: subscriptions.map((item) => ({
      ...item,
      student: { name: item.student.name, studentId: item.student.studentProfile?.studentId ?? '' },
      tutor: { name: item.tutor.name, tutorId: item.tutor.tutorProfile?.tutorId ?? '' },
    })),
  };
}

function feeBounds(period: SubscriptionPeriod, organization: {
  minimumMonthlyFee: { toNumber(): number } | null;
  maximumMonthlyFee: { toNumber(): number } | null;
  minimumQuarterlyFee: { toNumber(): number } | null;
  maximumQuarterlyFee: { toNumber(): number } | null;
  minimumYearlyFee: { toNumber(): number } | null;
  maximumYearlyFee: { toNumber(): number } | null;
}) {
  const suffix = period === SubscriptionPeriod.MONTHLY ? 'Monthly' : period === SubscriptionPeriod.QUARTERLY ? 'Quarterly' : 'Yearly';
  return {
    min: organization[`minimum${suffix}Fee` as keyof typeof organization]?.toNumber() ?? null,
    max: organization[`maximum${suffix}Fee` as keyof typeof organization]?.toNumber() ?? null,
  };
}

async function savePlanPrice(
  actor: PaymentActor,
  input: { courseId: string; period: SubscriptionPeriod; price: number; reason?: string },
  tutorId = actor.userId,
  allowOverride = false,
) {
  const orgId = tenantId(actor);
  if (actor.role === Role.TUTOR && (tutorId !== actor.userId || allowOverride)) {
    throw new HttpError(403, 'Tutors can only set their own course prices');
  }
  if (actor.role !== Role.TUTOR && !(allowOverride && actor.role === Role.ORG_ADMIN)) {
    throw new HttpError(403, 'Only a Tutor can set course prices');
  }
  const [organization, assignment, tutor] = await Promise.all([
    prisma.organization.findFirst({ where: { id: orgId }, select: {
      minimumMonthlyFee: true, maximumMonthlyFee: true, minimumQuarterlyFee: true,
      maximumQuarterlyFee: true, minimumYearlyFee: true, maximumYearlyFee: true,
    } }),
    prisma.courseInstructor.findFirst({
      where: { organizationId: orgId, courseId: input.courseId, instructorId: tutorId },
      select: { courseId: true },
    }),
    prisma.user.findFirst({
      where: { id: tutorId, organizationId: orgId, role: Role.TUTOR, status: AccountStatus.APPROVED },
      select: { id: true },
    }),
  ]);
  if (!organization) throw new HttpError(404, 'Organization not found');
  if (!assignment || !tutor) throw new HttpError(404, 'Assigned Tutor or course not found');
  const bounds = feeBounds(input.period, organization);
  if ((bounds.min !== null && input.price < bounds.min) || (bounds.max !== null && input.price > bounds.max)) {
    throw new HttpError(400, `The ${input.period.toLowerCase()} fee must be within the organization's fee bounds`);
  }
  return prisma.$transaction(async (tx) => {
    const prior = await tx.tutorCoursePlan.findUnique({
      where: { organizationId_tutorId_courseId_period: { organizationId: orgId, tutorId, courseId: input.courseId, period: input.period } },
      select: { id: true, price: true },
    });
    const plan = prior
      ? await tx.tutorCoursePlan.update({ where: { id: prior.id }, data: { price: input.price, isActive: true } })
      : await tx.tutorCoursePlan.create({
        data: { organizationId: orgId, tutorId, courseId: input.courseId, period: input.period, price: input.price },
      });
    if (!prior || prior.price.toNumber() !== input.price) {
      await tx.tutorCoursePlanHistory.create({
        data: {
          organizationId: orgId,
          planId: plan.id,
          changedById: actor.userId,
          previousPrice: prior?.price ?? null,
          newPrice: input.price,
          reason: input.reason ?? (allowOverride ? 'Organization admin override' : 'Tutor price update'),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorId: actor.userId,
          action: allowOverride ? 'PAYMENT_PLAN_PRICE_OVERRIDDEN' : 'TUTOR_PAYMENT_PLAN_PRICE_SET',
          targetType: 'TutorCoursePlan',
          targetId: plan.id,
          metadata: { tutorId, courseId: input.courseId, period: input.period, previousPrice: prior?.price.toString() ?? null, newPrice: input.price, reason: input.reason ?? null },
        },
      });
    }
    return { id: plan.id, courseId: plan.courseId, period: plan.period, price: plan.price.toNumber() };
  });
}

export async function setTutorPlanPrice(actor: PaymentActor, input: { courseId: string; period: SubscriptionPeriod; price: number }) {
  if (actor.role !== Role.TUTOR) throw new HttpError(403, 'Only Tutors can set their course prices');
  return savePlanPrice(actor, input);
}

export async function overridePlanPrice(actor: PaymentActor, planId: string, input: { price: number; reason: string }) {
  if (actor.role !== Role.ORG_ADMIN) throw new HttpError(403, 'Only the organization admin can override Tutor prices');
  const orgId = tenantId(actor);
  const plan = await prisma.tutorCoursePlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { courseId: true, period: true, tutorId: true },
  });
  if (!plan) throw new HttpError(404, 'Course fee plan not found');
  return savePlanPrice(actor, { ...input, courseId: plan.courseId, period: plan.period }, plan.tutorId, true);
}

export async function updateOrganizationPaymentSettings(actor: PaymentActor, input: {
  paymentsEnabled: boolean;
  currency: string;
  minimumMonthlyFee: number | null;
  maximumMonthlyFee: number | null;
  minimumQuarterlyFee: number | null;
  maximumQuarterlyFee: number | null;
  minimumYearlyFee: number | null;
  maximumYearlyFee: number | null;
  invoiceName: string | null;
  invoiceAddress: string | null;
  invoiceTaxId: string | null;
}) {
  requireManager(actor);
  const orgId = tenantId(actor);
  const updated = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.update({
      where: { id: orgId },
      data: input,
      select: { id: true, paymentsEnabled: true, currency: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId, actorId: actor.userId, action: 'ORGANIZATION_PAYMENT_SETTINGS_UPDATED',
        targetType: 'Organization', targetId: orgId, metadata: { paymentsEnabled: input.paymentsEnabled, currency: input.currency },
      },
    });
    return organization;
  });
  return updated;
}

export async function setOrganizationPaymentsEnabled(actor: PaymentActor, organizationId: string, paymentsEnabled: boolean) {
  if (actor.role !== Role.SUPER_ADMIN) throw new HttpError(403, 'Only Super Admin can change organization payment access');
  const organization = await prisma.organization.findFirst({ where: { id: organizationId }, select: { id: true, paymentsEnabled: true } });
  if (!organization) throw new HttpError(404, 'Organization not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: organizationId }, data: { paymentsEnabled }, select: { id: true, paymentsEnabled: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId, actorId: actor.userId, action: 'SUPER_ADMIN_ORGANIZATION_PAYMENTS_TOGGLED',
        targetType: 'Organization', targetId: organizationId, metadata: { paymentsEnabled },
      },
    });
    return updated;
  });
}

export async function setTutorAcceptingFees(actor: PaymentActor, tutorId: string, acceptsNewFees: boolean) {
  if (actor.role !== Role.ORG_ADMIN) throw new HttpError(403, 'Only the organization admin can change Tutor fee acceptance');
  const orgId = tenantId(actor);
  const tutor = await prisma.user.findFirst({
    where: { id: tutorId, organizationId: orgId, role: Role.TUTOR },
    select: { id: true, tutorProfile: { select: { acceptsNewFees: true } } },
  });
  if (!tutor?.tutorProfile) throw new HttpError(404, 'Tutor not found');
  return prisma.$transaction(async (tx) => {
    const profile = await tx.tutorProfile.update({
      where: { userId: tutorId }, data: { acceptsNewFees }, select: { acceptsNewFees: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId, actorId: actor.userId, action: 'TUTOR_FEE_ACCEPTANCE_UPDATED',
        targetType: 'TutorProfile', targetId: tutorId, metadata: { acceptsNewFees },
      },
    });
    return profile;
  });
}

export async function setSubscriptionStatus(
  actor: PaymentActor,
  subscriptionId: string,
  input: { status: Extract<SubscriptionStatus, 'ACTIVE' | 'INACTIVE'>; reason: string },
) {
  requireManager(actor);
  const orgId = actor.role === Role.SUPER_ADMIN ? undefined : tenantId(actor);
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, ...(orgId ? { organizationId: orgId } : {}) },
    select: {
      id: true, organizationId: true, studentId: true, status: true, endsAt: true,
      course: { select: { title: true } },
    },
  });
  if (!subscription) throw new HttpError(404, 'Subscription not found');
  if (input.status === SubscriptionStatus.ACTIVE && subscription.endsAt <= new Date()) {
    throw new HttpError(409, 'Expired subscriptions cannot be reactivated; the student must renew');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: input.status,
        deactivatedBy: input.status === SubscriptionStatus.INACTIVE ? actor.userId : null,
        deactivationReason: input.status === SubscriptionStatus.INACTIVE ? input.reason : null,
      },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: subscription.organizationId,
        actorId: actor.userId,
        action: input.status === SubscriptionStatus.INACTIVE ? 'SUBSCRIPTION_DEACTIVATED' : 'SUBSCRIPTION_REACTIVATED',
        targetType: 'Subscription',
        targetId: subscription.id,
        metadata: { reason: input.reason, studentId: subscription.studentId },
      },
    });
    return result;
  });
  await notifyAfterCommit(() => notifyUsers(subscription.organizationId, [subscription.studentId], {
    type: NotificationType.PAYMENT_STATUS,
    title: input.status === SubscriptionStatus.INACTIVE ? 'Course access paused' : 'Course access restored',
    body: input.status === SubscriptionStatus.INACTIVE
      ? `Your subscription for ${subscription.course.title} is inactive. Reason: ${input.reason}`
      : `Your subscription for ${subscription.course.title} has been reactivated.`,
    link: '/student/payments',
    dedupeKey: `subscription:${subscription.id}:${updated.status}:${updated.endsAt.toISOString()}`,
  }), 'Subscription status notification');
  return updated;
}

export async function refundPayment(actor: PaymentActor, paymentId: string, reason: string) {
  if (actor.role !== Role.ORG_ADMIN) throw new HttpError(403, 'Only the organization admin can refund payments');
  const orgId = tenantId(actor);
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: {
      id: true, status: true, studentId: true, organizationId: true, subscriptionId: true,
      course: { select: { title: true } },
    },
  });
  if (!payment) throw new HttpError(404, 'Payment not found');
  if (payment.status !== PaymentStatus.PAID) throw new HttpError(409, 'Only paid payments can be refunded');
  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED }, select: { id: true, status: true },
    });
    let subscriptionDeactivated = false;
    if (payment.subscriptionId) {
      const remainingPaid = await tx.payment.count({
        where: { subscriptionId: payment.subscriptionId, id: { not: payment.id }, status: PaymentStatus.PAID },
      });
      if (remainingPaid === 0) {
        await tx.subscription.updateMany({
          where: { id: payment.subscriptionId, organizationId: orgId, status: SubscriptionStatus.ACTIVE },
          data: { status: SubscriptionStatus.INACTIVE, deactivatedBy: actor.userId, deactivationReason: `Payment refunded: ${reason}` },
        });
        subscriptionDeactivated = true;
      }
    }
    await tx.auditLog.create({
      data: {
        organizationId: orgId, actorId: actor.userId, action: 'PAYMENT_REFUNDED',
        targetType: 'Payment', targetId: payment.id, metadata: { reason, subscriptionDeactivated },
      },
    });
    return { ...updatedPayment, subscriptionDeactivated };
  });
  await notifyAfterCommit(() => notifyUsers(orgId, [payment.studentId], {
    type: NotificationType.PAYMENT_STATUS,
    title: 'Course fee payment refunded',
    body: `Your payment for ${payment.course.title} was refunded. Reason: ${reason}`,
    link: '/student/payments',
    dedupeKey: `payment:${payment.id}:refunded`,
  }), 'Payment refund notification');
  return result;
}

export async function exportPaymentManagement(actor: PaymentActor, filters: PaymentFilters = {}) {
  const data = await paymentManagementData(actor, filters);
  return toCsv([
    ['Payment ID', 'Organization', 'Organization code', 'Student', 'Student ID', 'Tutor', 'Tutor ID', 'Course code', 'Course', 'Period start', 'Period end', 'Periods', 'Amount', 'Currency', 'Status', 'Subscription status', 'Paid on', 'Receipt'],
    ...data.payments.map((payment) => [
      payment.id, payment.organization?.name, payment.organization?.code,
      payment.student.name, payment.student.studentId, payment.tutor.name, payment.tutor.tutorId,
      payment.course.code, payment.course.title, payment.periodStart.toISOString(), payment.periodEnd.toISOString(),
      payment.periodsCount, payment.amount, payment.currency, payment.status, payment.subscription?.status,
      payment.createdAt.toISOString(), payment.receiptNumber,
    ]),
  ]);
}

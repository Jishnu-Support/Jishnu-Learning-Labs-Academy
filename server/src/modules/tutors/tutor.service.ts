import bcrypt from 'bcrypt';
import { AccountStatus, EnrollmentStatus, NotificationType, Prisma, Role, StudentStatus, SubscriptionStatus } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyAfterCommit, notifyUsers } from '../notifications/notifications.service.js';
import { tutorPhotoStorage } from './tutor-photo.storage.js';

type TutorListInput = { search?: string; status?: AccountStatus; page: number; pageSize: number };
type NewTutor = { tutorId: string; name: string; phone: string; email: string; joiningDate: string; temporaryPassword: string; bio?: string; expertise: string[] };
type TutorUpdate = Partial<Omit<NewTutor, 'temporaryPassword'>>;

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function tutorWhere(organizationId: string, input: TutorListInput, actorId?: string): Prisma.TutorProfileWhereInput {
  return {
    organizationId,
    user: {
      is: {
        organizationId,
        role: Role.TUTOR,
        ...(input.status ? { status: input.status } : {}),
        ...(actorId ? { id: actorId } : {}),
      },
    },
    ...(input.search ? {
      OR: [
        { tutorId: { contains: input.search, mode: 'insensitive' } },
        { user: { is: { organizationId, role: Role.TUTOR, name: { contains: input.search, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
}

const tutorSelection = {
  tutorId: true,
  joiningDate: true,
  bio: true,
  expertise: true,
  photoStorageKey: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } },
} satisfies Prisma.TutorProfileSelect;

function serializeTutor<T extends { tutorId: string; photoStorageKey: string | null }>(profile: T) {
  const { tutorId, photoStorageKey, ...rest } = profile;
  return { ...rest, tutorId: tutorId, hasPhoto: Boolean(photoStorageKey) };
}

async function ratingSummaries(organizationId: string, tutorIds: string[], courseId?: string) {
  if (!tutorIds.length) return new Map<string, { averageRating: number | null; reviewCount: number }>();
  const grouped = await prisma.tutorReview.groupBy({
    by: ['tutorId'],
    where: { organizationId, tutorId: { in: tutorIds }, ...(courseId ? { courseId } : {}) },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(grouped.map((entry) => [entry.tutorId, {
    averageRating: entry._avg.rating === null ? null : Math.round(entry._avg.rating * 10) / 10,
    reviewCount: entry._count._all,
  }]));
}

function emptyRatingSummary() {
  return { averageRating: null, reviewCount: 0 };
}

export async function listTutor(organizationId: string | null, input: TutorListInput, actorId: string, actorRole: Role) {
  const tenantId = requireOrganizationId(organizationId);
  const where = tutorWhere(tenantId, input, actorRole === Role.TUTOR ? actorId : undefined);
  const [total, tutor] = await prisma.$transaction([
    prisma.tutorProfile.count({ where }),
    prisma.tutorProfile.findMany({
      where,
      orderBy: { joiningDate: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: tutorSelection,
    }),
  ]);
  const summaries = await ratingSummaries(tenantId, tutor.map(({ user }) => user.id));
  return {
    tutors: tutor.map((profile) => ({
      ...serializeTutor(profile),
      ratingSummary: summaries.get(profile.user.id) ?? emptyRatingSummary(),
    })),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function listAvailableTutors(organizationId: string | null, studentId: string, courseId?: string) {
  const tenantId = requireOrganizationId(organizationId);
  if (courseId) {
    const enrollment = await prisma.enrollment.findFirst({
      where: { organizationId: tenantId, studentId, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) throw new HttpError(403, 'You must be actively enrolled in this course to choose a Tutor');
  }
  const profiles = await prisma.tutorProfile.findMany({
    where: {
      organizationId: tenantId,
      user: {
        is: {
          organizationId: tenantId,
          role: Role.TUTOR,
          status: AccountStatus.APPROVED,
          isActive: true,
          ...(courseId ? { instructedCourses: { some: { organizationId: tenantId, courseId } } } : {}),
        },
      },
    },
    orderBy: [{ joiningDate: 'asc' }, { tutorId: 'asc' }],
    select: {
      userId: true,
      joiningDate: true,
      bio: true,
      expertise: true,
      photoStorageKey: true,
      user: { select: { name: true } },
    },
  });
  const tutorIds = profiles.map(({ userId }) => userId);
  const [summaries, ownReviews] = await Promise.all([
    ratingSummaries(tenantId, tutorIds, courseId),
    studentId
      ? prisma.tutorReview.findMany({
        where: { organizationId: tenantId, studentId, tutorId: { in: tutorIds }, ...(courseId ? { courseId } : {}) },
        select: { tutorId: true, courseId: true, rating: true, review: true },
      })
      : Promise.resolve([]),
  ]);
  const ownReviewsByTutor = new Map(ownReviews.map((review) => [`${review.tutorId}:${review.courseId}`, { rating: review.rating, review: review.review }]));
  const plans = courseId ? await prisma.tutorCoursePlan.findMany({
    where: { organizationId: tenantId, courseId, isActive: true, tutorId: { in: tutorIds } },
    select: { tutorId: true, period: true, price: true },
  }) : [];
  return {
    tutors: profiles.map(({ photoStorageKey, userId, user, ...profile }) => ({
      id: userId,
      name: user.name,
      ...profile,
      hasPhoto: Boolean(photoStorageKey),
      ratingSummary: summaries.get(userId) ?? emptyRatingSummary(),
      myReview: ownReviewsByTutor.get(`${userId}:${courseId ?? ''}`) ?? null,
      coursePrices: plans.filter((plan) => plan.tutorId === userId).map((plan) => ({
        period: plan.period,
        price: plan.price.toNumber(),
      })),
    })),
  };
}

export async function getPreferredTutor(organizationId: string | null, studentId: string, courseId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const enrollment = await prisma.enrollment.findFirst({
    where: { organizationId: tenantId, studentId, courseId, status: EnrollmentStatus.ACTIVE },
    select: { selectedTutorId: true },
  });
  if (!enrollment) throw new HttpError(403, 'Active course enrollment required');
  const activeSubscriptionTutor = enrollment.selectedTutorId ? null : await prisma.subscription.findFirst({
    where: { organizationId: tenantId, studentId, courseId, status: SubscriptionStatus.ACTIVE, endsAt: { gt: new Date() } },
    select: { tutorId: true },
  });
  const selectedTutorId = enrollment.selectedTutorId ?? activeSubscriptionTutor?.tutorId;
  if (!selectedTutorId) return null;
  const tutors = await listAvailableTutors(tenantId, studentId, courseId);
  return tutors.tutors.find(({ id }) => id === selectedTutorId) ?? null;
}

export async function selectPreferredTutor(organizationId: string | null, studentId: string, courseId: string, tutorId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const tutor = await prisma.tutorProfile.findFirst({
    where: {
      organizationId: tenantId,
      userId: tutorId,
      user: { is: { organizationId: tenantId, role: Role.TUTOR, status: AccountStatus.APPROVED, isActive: true } },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  if (!tutor) throw new HttpError(404, 'Approved Tutor not found in your organization');
  const [enrollment, assignment, course, activeSubscription] = await Promise.all([
    prisma.enrollment.findFirst({
      where: { organizationId: tenantId, studentId, courseId, status: EnrollmentStatus.ACTIVE },
      select: { id: true, selectedTutorId: true, pendingTutorId: true },
    }),
    prisma.courseInstructor.findFirst({
      where: { organizationId: tenantId, courseId, instructorId: tutorId },
      select: { courseId: true },
    }),
    prisma.course.findFirst({ where: { id: courseId, organizationId: tenantId }, select: { title: true } }),
    prisma.subscription.findFirst({
      where: { organizationId: tenantId, studentId, courseId, status: SubscriptionStatus.ACTIVE, endsAt: { gt: new Date() } },
      select: { id: true, tutorId: true },
    }),
  ]);
  if (!enrollment || !course) throw new HttpError(403, 'Active course enrollment required');
  if (!assignment) throw new HttpError(404, 'This Tutor is not assigned to the selected course');
  const oldTutorId = enrollment.selectedTutorId ?? activeSubscription?.tutorId ?? null;
  const pending = Boolean(activeSubscription && oldTutorId !== tutorId);
  const changed = pending
    ? enrollment.pendingTutorId !== tutorId
    : enrollment.selectedTutorId !== tutorId || enrollment.pendingTutorId !== null;
  if (changed) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.enrollment.updateMany({
        where: { id: enrollment.id, organizationId: tenantId, studentId, status: EnrollmentStatus.ACTIVE },
        data: pending ? { pendingTutorId: tutorId } : { selectedTutorId: tutorId, pendingTutorId: null },
      });
      if (updated.count !== 1) throw new HttpError(409, 'Course enrollment changed; refresh and try again');
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId: studentId,
          action: pending ? 'STUDENT_TUTOR_CHANGE_SCHEDULED' : 'STUDENT_TUTOR_CHANGED',
          targetType: 'Enrollment',
          targetId: enrollment.id,
          metadata: { courseId, oldTutorId, newTutorId: tutorId, effectiveAtRenewal: pending },
        },
      });
    });
    const recipients = [tutorId, ...(oldTutorId && oldTutorId !== tutorId ? [oldTutorId] : [])];
    await notifyAfterCommit(() => notifyUsers(tenantId, recipients, {
      type: NotificationType.SYSTEM,
      courseId,
      title: pending ? 'Tutor change scheduled' : 'New course Tutor selected',
      body: `A Tutor assignment for ${course.title} has changed.`,
      link: '/tutor',
      dedupeKey: `student-tutor:${enrollment.id}:${tutorId}:${pending ? 'renewal' : 'now'}`,
    }), 'Student Tutor selection notifications');
  }
  return { tutor: await getPreferredTutor(tenantId, studentId, courseId), effectiveAtRenewal: pending };
}

function containsProfanity(value: string) {
  return /\b(?:fuck|shit|bitch|asshole|bastard)\b/i.test(value);
}

async function hasCourseActivity(organizationId: string, studentId: string, courseId: string) {
  const [attendance, watch, noteView] = await Promise.all([
    prisma.attendanceRecord.findFirst({
      where: { organizationId, studentId, courseId, status: { in: ['PRESENT', 'LATE'] } },
      select: { id: true },
    }),
    prisma.watchProgress.findFirst({
      where: { organizationId, studentId, watchedSeconds: { gt: 0 }, media: { is: { organizationId, courseId } } },
      select: { id: true },
    }),
    prisma.noteView.findFirst({
      where: { organizationId, userId: studentId, note: { is: { organizationId, courseId } } },
      select: { id: true },
    }),
  ]);
  return Boolean(attendance || watch || noteView);
}

export async function submitTutorReview(
  organizationId: string | null,
  studentId: string,
  tutorId: string,
  input: { courseId: string; rating: number; review?: string | null },
) {
  const tenantId = requireOrganizationId(organizationId);
  if (input.review && containsProfanity(input.review)) {
    throw new HttpError(400, 'Please revise your review to remove inappropriate language');
  }
  const [tutor, organization, enrollment, existing] = await Promise.all([
    prisma.tutorProfile.findFirst({
      where: {
        organizationId: tenantId,
        userId: tutorId,
        user: { is: { role: Role.TUTOR, status: AccountStatus.APPROVED, isActive: true } },
      },
      select: { userId: true },
    }),
    prisma.organization.findFirst({ where: { id: tenantId }, select: { ratingRequiresActivity: true } }),
    prisma.enrollment.findFirst({
      where: { organizationId: tenantId, studentId, courseId: input.courseId, status: EnrollmentStatus.ACTIVE, selectedTutorId: tutorId },
      select: { id: true },
    }),
    prisma.tutorReview.findUnique({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: tenantId, studentId, tutorId, courseId: input.courseId } },
      select: { id: true },
    }),
  ]);
  if (!tutor) throw new HttpError(404, 'Approved Tutor not found in your organization');
  if (!enrollment) throw new HttpError(403, 'Select this Tutor for an active course enrollment before submitting a review');
  if (organization?.ratingRequiresActivity && !(await hasCourseActivity(tenantId, studentId, input.courseId))) {
    throw new HttpError(403, 'Complete a course session or view course content before rating this Tutor');
  }

  const review = await prisma.$transaction(async (tx) => {
    const saved = await tx.tutorReview.upsert({
      where: { organizationId_studentId_tutorId_courseId: { organizationId: tenantId, studentId, tutorId, courseId: input.courseId } },
      create: {
        organizationId: tenantId,
        studentId,
        tutorId,
        courseId: input.courseId,
        rating: input.rating,
        review: input.review?.trim() || null,
      },
      update: { rating: input.rating, review: input.review?.trim() || null },
    });
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId: studentId,
        action: existing ? 'TUTOR_REVIEW_UPDATED' : 'TUTOR_REVIEW_CREATED',
        targetType: 'TutorReview',
        targetId: saved.id,
        metadata: { tutorId, courseId: input.courseId, rating: input.rating },
      },
    });
    return saved;
  });
  await notifyAfterCommit(async () => {
    const admins = await prisma.user.findMany({
      where: { organizationId: tenantId, role: Role.ORG_ADMIN, isActive: true, status: AccountStatus.APPROVED },
      select: { id: true },
    });
    await Promise.all([
      notifyUsers(tenantId, [tutorId], {
        type: NotificationType.SYSTEM,
        courseId: input.courseId,
        title: 'New Tutor rating received',
        body: `A student submitted a ${input.rating}-star rating for your course.`,
        link: '/tutor/ratings',
        dedupeKey: `tutor-review:${review.id}:tutor:${review.updatedAt.getTime()}`,
      }),
      ...(input.rating <= 2 ? [notifyUsers(tenantId, admins.map(({ id }) => id), {
        type: NotificationType.SYSTEM,
        courseId: input.courseId,
        title: 'Low Tutor rating received',
        body: 'A new 1- or 2-star Tutor rating needs review.',
        link: '/org-admin/tutor-ratings',
        dedupeKey: `tutor-review:${review.id}:admin:${review.updatedAt.getTime()}`,
      })] : []),
    ]);
  }, 'Tutor rating notifications');
  return review;
}

export async function deleteTutorReview(organizationId: string | null, studentId: string, tutorId: string, courseId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const result = await prisma.tutorReview.deleteMany({
    where: { organizationId: tenantId, studentId, tutorId, courseId },
  });
  if (!result.count) throw new HttpError(404, 'Your Tutor review was not found');
  await prisma.auditLog.create({
    data: {
      organizationId: tenantId,
      actorId: studentId,
      action: 'TUTOR_REVIEW_DELETED',
      targetType: 'TutorReview',
      targetId: `${studentId}:${tutorId}:${courseId}`,
      metadata: { tutorId, courseId },
    },
  });
}

export async function listTutorReviews(
  organizationId: string | null,
  tutorId: string,
  actorId: string,
  actorRole: Role,
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && actorId !== tutorId) {
    throw new HttpError(403, 'Tutors can view reviews only for their own profile');
  }
  const profile = await prisma.tutorProfile.findFirst({
    where: { organizationId: tenantId, userId: tutorId, user: { is: { role: Role.TUTOR } } },
    select: { userId: true },
  });
  if (!profile) throw new HttpError(404, 'Tutor not found');
  const summary = await ratingSummaries(tenantId, [tutorId]);
  const reviews = await prisma.tutorReview.findMany({
    where: { organizationId: tenantId, tutorId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true, courseId: true, rating: true, review: true, createdAt: true, updatedAt: true, hiddenAt: true,
      hiddenReason: true, course: { select: { title: true } },
      student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
    },
  });
  const distribution = await prisma.tutorReview.groupBy({
    by: ['rating'],
    where: { organizationId: tenantId, tutorId },
    _count: { _all: true },
  });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trend = await prisma.tutorReview.findMany({
    where: { organizationId: tenantId, tutorId, createdAt: { gte: monthStart } },
    select: { rating: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const monthly = new Map<string, { total: number; count: number }>();
  for (const item of trend) {
    const key = `${item.createdAt.getFullYear()}-${String(item.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const entry = monthly.get(key) ?? { total: 0, count: 0 };
    entry.total += item.rating;
    entry.count += 1;
    monthly.set(key, entry);
  }
  return {
    ratingSummary: summary.get(tutorId) ?? emptyRatingSummary(),
    distribution: Array.from({ length: 5 }, (_, index) => {
      const rating = index + 1;
      return { rating, count: distribution.find((entry) => entry.rating === rating)?._count._all ?? 0 };
    }),
    trend: [...monthly.entries()].map(([month, entry]) => ({ month, averageRating: Math.round(entry.total / entry.count * 10) / 10, count: entry.count })),
    reviews: reviews.map(({ student, ...review }) => ({
      ...review,
      ...(actorRole === Role.ORG_ADMIN
        ? { student: { name: student.name, studentId: student.studentProfile?.studentId ?? null } }
        : {
          review: review.hiddenAt ? null : review.review,
          student: null,
          hiddenAt: undefined,
          hiddenReason: undefined,
        }),
    })),
  };
}

export async function setTutorReviewVisibility(
  organizationId: string | null,
  reviewId: string,
  actorId: string,
  hidden: boolean,
  reason: string,
) {
  const tenantId = requireOrganizationId(organizationId);
  const review = await prisma.tutorReview.findFirst({ where: { id: reviewId, organizationId: tenantId }, select: { id: true, tutorId: true } });
  if (!review) throw new HttpError(404, 'Tutor review not found');
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.tutorReview.update({
      where: { id: review.id },
      data: { hiddenAt: hidden ? new Date() : null, hiddenReason: hidden ? reason : null },
      select: { id: true, hiddenAt: true, hiddenReason: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: tenantId, actorId,
        action: hidden ? 'TUTOR_REVIEW_HIDDEN' : 'TUTOR_REVIEW_UNHIDDEN',
        targetType: 'TutorReview', targetId: review.id, metadata: { tutorId: review.tutorId, reason },
      },
    });
    return saved;
  });
  return updated;
}

export async function tutorRatingDashboard(organizationId: string | null, tutorId: string, actorId: string, actorRole: Role) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && actorId !== tutorId) throw new HttpError(403, 'Tutors can view only their own ratings');
  if (actorRole !== Role.TUTOR && actorRole !== Role.ORG_ADMIN) throw new HttpError(403, 'Tutor rating dashboard is unavailable');
  const tutor = await prisma.tutorProfile.findFirst({ where: { organizationId: tenantId, userId: tutorId }, select: { userId: true } });
  if (!tutor) throw new HttpError(404, 'Tutor not found');
  return listTutorReviews(tenantId, tutorId, actorId, actorRole);
}

export async function listOrganizationTutorReviews(organizationId: string | null) {
  const tenantId = requireOrganizationId(organizationId);
  const reviews = await prisma.tutorReview.findMany({
    where: { organizationId: tenantId },
    select: {
      id: true, tutorId: true, courseId: true, rating: true, review: true, createdAt: true, hiddenAt: true, hiddenReason: true,
      tutor: { select: { name: true, tutorProfile: { select: { tutorId: true } } } },
      course: { select: { title: true } },
      student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return reviews.map((item) => ({
    id: item.id, tutorId: item.tutorId, courseId: item.courseId, rating: item.rating, review: item.review,
    createdAt: item.createdAt, hiddenAt: item.hiddenAt, hiddenReason: item.hiddenReason,
    tutor: { name: item.tutor.name, tutorId: item.tutor.tutorProfile?.tutorId ?? null },
    course: item.course,
    student: { name: item.student.name, studentId: item.student.studentProfile?.studentId ?? null },
  }));
}

export async function getTutor(organizationId: string | null, userId: string, actorId: string, actorRole: Role) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && actorId !== userId) {
    throw new HttpError(403, 'Tutors can view only their own profile');
  }
  const tutor = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: tutorSelection,
  });
  if (!tutor) throw new HttpError(404, 'Tutor not found');
  const [summaries, reviews] = await Promise.all([
    ratingSummaries(tenantId, [userId]),
    actorRole === Role.ORG_ADMIN || (actorRole === Role.TUTOR && actorId === userId)
      ? listTutorReviews(tenantId, userId, actorId, actorRole)
      : Promise.resolve(null),
  ]);
  return {
    ...serializeTutor(tutor),
    ratingSummary: summaries.get(userId) ?? emptyRatingSummary(),
    ...(reviews ? { reviews: reviews.reviews } : {}),
  };
}

export async function createTutor(organizationId: string | null, actorId: string, input: NewTutor) {
  const tenantId = requireOrganizationId(organizationId);
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
  try {
    const tutor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: tenantId,
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone,
          role: Role.TUTOR,
          status: AccountStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
          mustChangePassword: true,
          tutorProfile: {
            create: {
              organizationId: tenantId,
              tutorId: input.tutorId,
              joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`),
              bio: input.bio,
              expertise: input.expertise,
            },
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'TUTOR_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { tutorId: input.tutorId, email: input.email },
        },
      });
      return tx.tutorProfile.findFirstOrThrow({ where: { userId: user.id, organizationId: tenantId }, select: tutorSelection });
    });
    return { tutor: serializeTutor(tutor), temporaryPassword: input.temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Tutor ID or email is already in use in this organization');
    }
    throw error;
  }
}

export async function updateTutor(organizationId: string | null, userId: string, actorId: string, input: TutorUpdate) {
  const tenantId = requireOrganizationId(organizationId);
  const current = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { id: true, userId: true },
  });
  if (!current) throw new HttpError(404, 'Tutor not found');
  try {
    await prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.email !== undefined || input.phone !== undefined) {
        await tx.user.update({
          where: { id: current.userId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
          },
        });
      }
      if (input.tutorId !== undefined || input.joiningDate !== undefined || input.bio !== undefined || input.expertise !== undefined) {
        await tx.tutorProfile.update({
          where: { id: current.id },
          data: {
            ...(input.tutorId !== undefined ? { tutorId: input.tutorId } : {}),
            ...(input.joiningDate !== undefined ? { joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`) } : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
            ...(input.expertise !== undefined ? { expertise: input.expertise } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'TUTOR_UPDATED',
          targetType: 'User',
          targetId: current.userId,
          metadata: { changedFields: Object.keys(input) },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Tutor ID or email is already in use in this organization');
    }
    throw error;
  }
  return getTutor(tenantId, userId, actorId, Role.ORG_ADMIN);
}

async function setTutorStatus(
  organizationId: string | null,
  userId: string,
  actorId: string,
  status: typeof AccountStatus.APPROVED | typeof AccountStatus.SUSPENDED,
) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { id: true, user: { select: { status: true, accountRegistration: { select: { id: true } } } } },
  });
  if (!profile) throw new HttpError(404, 'Tutor not found');
  if (status === AccountStatus.SUSPENDED && profile.user.status !== AccountStatus.APPROVED) {
    throw new HttpError(409, 'Only approved Tutors can be suspended');
  }
  if (status === AccountStatus.APPROVED && profile.user.status !== AccountStatus.SUSPENDED) {
    throw new HttpError(409, 'Only suspended Tutors can be reactivated');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, organizationId: tenantId, role: Role.TUTOR, status: profile.user.status },
      data: { status, rejectionReason: null },
    });
    if (updated.count !== 1) throw new HttpError(409, 'Tutor status changed; refresh and try again');
    if (profile.user.accountRegistration) {
      await tx.accountApproval.updateMany({
        where: { id: profile.user.accountRegistration.id, organizationId: tenantId },
        data: { status: status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.SUSPENDED },
      });
    }
    if (status === AccountStatus.SUSPENDED) {
      await tx.session.updateMany({
        where: { organizationId: tenantId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: status === AccountStatus.SUSPENDED ? 'TUTOR_SUSPENDED' : 'TUTOR_REACTIVATED',
        targetType: 'User',
        targetId: userId,
        metadata: {},
      },
    });
  });
  return getTutor(tenantId, userId, actorId, Role.ORG_ADMIN);
}

export function suspendTutor(organizationId: string | null, userId: string, actorId: string) {
  return setTutorStatus(organizationId, userId, actorId, AccountStatus.SUSPENDED);
}

export function reactivateTutor(organizationId: string | null, userId: string, actorId: string) {
  return setTutorStatus(organizationId, userId, actorId, AccountStatus.APPROVED);
}

export async function uploadTutorPhoto(
  organizationId: string | null,
  userId: string,
  actorId: string,
  actorRole: Role,
  buffer: Buffer,
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && userId !== actorId) throw new HttpError(403, 'Tutors can only update their own profile photo');
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { photoStorageKey: true },
  });
  if (!profile) throw new HttpError(404, 'Tutor not found');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !['png', 'jpg', 'webp'].includes(detected.ext)) {
    throw new HttpError(400, 'Profile photos must be PNG, JPG, or WEBP images');
  }
  const storageKey = await tutorPhotoStorage.save(buffer, `.${detected.ext}`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tutorProfile.updateMany({
        where: { organizationId: tenantId, userId },
        data: { photoStorageKey: storageKey },
      });
      await tx.auditLog.create({
        data: { organizationId: tenantId, actorId, action: 'TUTOR_PROFILE_PHOTO_UPDATED', targetType: 'User', targetId: userId, metadata: {} },
      });
    });
  } catch (error) {
    await tutorPhotoStorage.remove(storageKey);
    throw error;
  }
  if (profile.photoStorageKey) {
    try {
      await tutorPhotoStorage.remove(profile.photoStorageKey);
    } catch (error) {
      logger.error({ err: error, userId, organizationId: tenantId }, 'Unable to remove the replaced tutor profile photo');
    }
  }
  return { photoUrl: `/tutors/${userId}/photo` };
}

export async function getTutorPhoto(organizationId: string | null, userId: string, actorId: string, actorRole: Role) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && actorId !== userId) {
    throw new HttpError(403, 'Tutors can view only their own profile photo');
  }
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR, status: AccountStatus.APPROVED, isActive: true } } },
    select: { photoStorageKey: true },
  });
  if (!profile?.photoStorageKey) throw new HttpError(404, 'Tutor profile photo not found');
  const file = await tutorPhotoStorage.open(profile.photoStorageKey);
  const extension = profile.photoStorageKey.split('.').pop();
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ...file, mimeType };
}

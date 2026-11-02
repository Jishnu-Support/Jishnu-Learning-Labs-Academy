import {
  AccountStatus,
  AssessmentStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

type CourseInput = {
  code: string;
  title: string;
  description?: string | null;
  category: string;
  plannedHours: number;
  startDate: string;
  endDate: string;
  minimumAttendancePercent: number;
  requiresAssessmentPass: boolean;
  instructorIds: string[];
};
type CourseUpdate = Partial<CourseInput>;
type ListInput = { search?: string; status?: CourseStatus };

const courseInclude = {
  instructors: {
    select: { instructor: { select: { id: true, name: true } } },
    orderBy: { assignedAt: 'asc' as const },
  },
  topics: { orderBy: { order: 'asc' as const } },
  notes: {
    where: { deletedAt: null },
    select: { id: true, title: true, subject: true, published: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' as const },
  },
  _count: { select: { enrollments: true, notes: true } },
} satisfies Prisma.CourseInclude;

function courseWhere(organizationId: string, userId: string, role: Role, input: ListInput = {}): Prisma.CourseWhereInput {
  return {
    organizationId,
    ...(role === Role.INSTRUCTOR ? { instructors: { some: { instructorId: userId } } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.search ? {
      OR: [
        { code: { contains: input.search, mode: 'insensitive' } },
        { title: { contains: input.search, mode: 'insensitive' } },
        { category: { contains: input.search, mode: 'insensitive' } },
      ],
    } : {}),
  };
}

function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function validateInstructors(organizationId: string, instructorIds: string[]) {
  const distinctIds = [...new Set(instructorIds)];
  if (distinctIds.length !== instructorIds.length) throw new HttpError(400, 'Instructor IDs must be unique');
  const instructors = await prisma.user.findMany({
    where: {
      id: { in: distinctIds },
      organizationId,
      role: Role.INSTRUCTOR,
      status: AccountStatus.APPROVED,
      isActive: true,
    },
    select: { id: true },
  });
  if (instructors.length !== distinctIds.length) {
    throw new HttpError(400, 'Select only active, approved instructors from your organization');
  }
}

async function managedCourse(organizationId: string, userId: string, role: Role, courseId: string) {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId,
      ...(role === Role.INSTRUCTOR ? { instructors: { some: { instructorId: userId } } } : {}),
    },
    include: courseInclude,
  });
  if (!course) throw new HttpError(404, 'Course not found');
  return course;
}

async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({
    data: { organizationId, actorId, action, targetType, targetId, metadata },
  });
}

export async function listCourses(organizationId: string, userId: string, role: Role, input: ListInput) {
  return prisma.course.findMany({
    where: courseWhere(organizationId, userId, role, input),
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    include: courseInclude,
  });
}

export async function listAssignableInstructors(organizationId: string, actorId: string, role: Role) {
  return prisma.user.findMany({
    where: {
      organizationId,
      role: Role.INSTRUCTOR,
      status: AccountStatus.APPROVED,
      isActive: true,
      ...(role === Role.INSTRUCTOR ? { id: actorId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function getManagedCourse(organizationId: string, userId: string, role: Role, courseId: string) {
  return managedCourse(organizationId, userId, role, courseId);
}

export async function createCourse(organizationId: string, actorId: string, role: Role, input: CourseInput) {
  if (isoDate(input.endDate) < isoDate(input.startDate)) throw new HttpError(400, 'End date must be on or after the start date');
  if (role === Role.INSTRUCTOR && input.instructorIds.some((id) => id !== actorId)) {
    throw new HttpError(403, 'Only an organization administrator can assign other instructors');
  }
  await validateInstructors(organizationId, input.instructorIds);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.course.create({
        data: {
          organizationId,
          createdById: actorId,
          code: input.code,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          plannedHours: input.plannedHours,
          startDate: isoDate(input.startDate),
          endDate: isoDate(input.endDate),
          minimumAttendancePercent: input.minimumAttendancePercent,
          requiresAssessmentPass: input.requiresAssessmentPass,
        },
      });
      await tx.courseInstructor.createMany({
        data: input.instructorIds.map((instructorId) => ({ organizationId, courseId: created.id, instructorId })),
      });
      const course = await tx.course.findUniqueOrThrow({ where: { id: created.id }, include: courseInclude });
      await audit(tx, organizationId, actorId, 'COURSE_CREATED', 'Course', course.id, { code: course.code });
      return course;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'A course with this code already exists in your organization');
    }
    throw error;
  }
}

export async function updateCourse(
  organizationId: string,
  actorId: string,
  role: Role,
  courseId: string,
  input: CourseUpdate,
) {
  const existing = await managedCourse(organizationId, actorId, role, courseId);
  if (existing.status === CourseStatus.ARCHIVED) throw new HttpError(409, 'Archived courses cannot be edited');
  if (role !== Role.ORG_ADMIN && input.instructorIds !== undefined) {
    throw new HttpError(403, 'Only an organization administrator can reassign course instructors');
  }
  const nextStartDate = input.startDate ? isoDate(input.startDate) : existing.startDate;
  const nextEndDate = input.endDate ? isoDate(input.endDate) : existing.endDate;
  if (nextEndDate < nextStartDate) throw new HttpError(400, 'End date must be on or after the start date');
  const nextHours = input.plannedHours ?? existing.plannedHours;
  const currentTopicHours = existing.topics.reduce((total, topic) => total + topic.plannedHours, 0);
  if (nextHours < currentTopicHours) throw new HttpError(409, 'Course planned hours cannot be less than the sum of its topic hours');
  if (input.instructorIds) await validateInstructors(organizationId, input.instructorIds);

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.instructorIds) {
        await tx.courseInstructor.deleteMany({ where: { organizationId, courseId } });
        await tx.courseInstructor.createMany({
          data: input.instructorIds.map((instructorId) => ({ organizationId, courseId, instructorId })),
        });
      }
      const course = await tx.course.update({
        where: { id: courseId },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.plannedHours !== undefined ? { plannedHours: input.plannedHours } : {}),
          ...(input.startDate !== undefined ? { startDate: nextStartDate } : {}),
          ...(input.endDate !== undefined ? { endDate: nextEndDate } : {}),
          ...(input.minimumAttendancePercent !== undefined ? { minimumAttendancePercent: input.minimumAttendancePercent } : {}),
          ...(input.requiresAssessmentPass !== undefined ? { requiresAssessmentPass: input.requiresAssessmentPass } : {}),
        },
        include: courseInclude,
      });
      await audit(tx, organizationId, actorId, 'COURSE_UPDATED', 'Course', course.id, { changedFields: Object.keys(input) });
      return course;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'A course with this code already exists in your organization');
    }
    throw error;
  }
}

export async function archiveCourse(organizationId: string, actorId: string, role: Role, courseId: string) {
  const existing = await managedCourse(organizationId, actorId, role, courseId);
  if (existing.status === CourseStatus.ARCHIVED) throw new HttpError(409, 'Course is already archived');
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.update({ where: { id: courseId }, data: { status: CourseStatus.ARCHIVED }, include: courseInclude });
    await audit(tx, organizationId, actorId, 'COURSE_ARCHIVED', 'Course', course.id);
    return course;
  });
}

export async function publishCourse(organizationId: string, actorId: string, role: Role, courseId: string) {
  const existing = await managedCourse(organizationId, actorId, role, courseId);
  if (existing.status !== CourseStatus.DRAFT) throw new HttpError(409, 'Only draft courses can be published');
  if (existing.topics.length === 0) throw new HttpError(409, 'Add at least one topic before publishing');
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.update({ where: { id: courseId }, data: { status: CourseStatus.PUBLISHED }, include: courseInclude });
    await audit(tx, organizationId, actorId, 'COURSE_PUBLISHED', 'Course', course.id);
    return course;
  });
}

export async function createTopic(
  organizationId: string,
  actorId: string,
  role: Role,
  courseId: string,
  input: { title: string; plannedHours: number },
) {
  const course = await managedCourse(organizationId, actorId, role, courseId);
  if (course.status === CourseStatus.ARCHIVED) throw new HttpError(409, 'Archived courses cannot be changed');
  const currentHours = course.topics.reduce((total, topic) => total + topic.plannedHours, 0);
  if (currentHours + input.plannedHours > course.plannedHours) {
    throw new HttpError(409, 'Topic hours cannot exceed the course planned hours');
  }
  const order = course.topics.reduce((max, topic) => Math.max(max, topic.order), 0) + 1;
  return prisma.$transaction(async (tx) => {
    const topic = await tx.courseTopic.create({
      data: { organizationId, courseId, title: input.title, plannedHours: input.plannedHours, order },
    });
    await audit(tx, organizationId, actorId, 'COURSE_TOPIC_CREATED', 'CourseTopic', topic.id, { courseId });
    return topic;
  });
}

export async function reorderTopics(
  organizationId: string,
  actorId: string,
  role: Role,
  courseId: string,
  topicIds: string[],
) {
  const course = await managedCourse(organizationId, actorId, role, courseId);
  if (course.status === CourseStatus.ARCHIVED) throw new HttpError(409, 'Archived courses cannot be changed');
  const existingIds = course.topics.map((topic) => topic.id);
  if (existingIds.length !== topicIds.length || topicIds.some((id) => !existingIds.includes(id))) {
    throw new HttpError(400, 'Reorder must include every course topic exactly once');
  }
  await prisma.$transaction(async (tx) => {
    await tx.courseTopic.updateMany({
      where: { organizationId, courseId },
      data: { order: { multiply: -1 } },
    });
    for (const [index, id] of topicIds.entries()) {
      await tx.courseTopic.update({ where: { id }, data: { order: index + 1 } });
    }
    await audit(tx, organizationId, actorId, 'COURSE_TOPICS_REORDERED', 'Course', courseId, { topicIds });
  });
  return managedCourse(organizationId, actorId, role, courseId);
}

export async function setTopicCovered(
  organizationId: string,
  actorId: string,
  role: Role,
  courseId: string,
  topicId: string,
  covered: boolean,
) {
  const course = await managedCourse(organizationId, actorId, role, courseId);
  if (course.status === CourseStatus.ARCHIVED) throw new HttpError(409, 'Archived courses cannot be changed');
  const topic = course.topics.find((item) => item.id === topicId);
  if (!topic) throw new HttpError(404, 'Course topic not found');
  if (topic.covered === covered) return topic;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.courseTopic.update({
      where: { id: topicId },
      data: { covered, coveredAt: covered ? new Date() : null },
    });
    await audit(tx, organizationId, actorId, covered ? 'COURSE_TOPIC_COVERED' : 'COURSE_TOPIC_UNCOVERED', 'CourseTopic', topicId, { courseId });
    return updated;
  });
}

export async function listEnrollments(organizationId: string, actorId: string, role: Role, courseId: string, search?: string) {
  await managedCourse(organizationId, actorId, role, courseId);
  return prisma.enrollment.findMany({
    where: {
      organizationId,
      courseId,
      ...(search ? {
        student: {
          OR: [
            { studentProfile: { studentId: { contains: search, mode: 'insensitive' } } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        },
      } : {}),
    },
    orderBy: [{ enrolledAt: 'desc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      completedAt: true,
      student: {
        select: {
          name: true,
          studentProfile: { select: { studentId: true } },
        },
      },
    },
  });
}

export async function approveEnrollment(
  organizationId: string,
  actorId: string,
  role: Role,
  courseId: string,
  enrollmentId: string,
) {
  await managedCourse(organizationId, actorId, role, courseId);
  const enrollment = await prisma.enrollment.findFirst({ where: { id: enrollmentId, organizationId, courseId } });
  if (!enrollment) throw new HttpError(404, 'Enrollment not found');
  if (enrollment.status !== EnrollmentStatus.PENDING) throw new HttpError(409, 'Enrollment is not pending approval');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: EnrollmentStatus.ACTIVE },
      select: { id: true, status: true, enrolledAt: true },
    });
    await audit(tx, organizationId, actorId, 'COURSE_ENROLLMENT_APPROVED', 'Enrollment', enrollment.id, { courseId });
    return updated;
  });
}

export async function browseStudentCourses(organizationId: string, studentId: string, search?: string) {
  return prisma.course.findMany({
    where: {
      organizationId,
      status: CourseStatus.PUBLISHED,
      ...(search ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    include: {
      instructors: { select: { instructor: { select: { name: true } } }, orderBy: { assignedAt: 'asc' } },
      _count: { select: { topics: true } },
      enrollments: {
        where: { studentId },
        select: { id: true, status: true },
        take: 1,
      },
    },
  });
}

export async function listStudentEnrollments(organizationId: string, studentId: string) {
  return prisma.enrollment.findMany({
    where: { organizationId, studentId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] }, course: { status: CourseStatus.PUBLISHED } },
    orderBy: { enrolledAt: 'desc' },
    include: {
      course: {
        include: {
          instructors: { select: { instructor: { select: { name: true } } }, orderBy: { assignedAt: 'asc' } },
          topics: { orderBy: { order: 'asc' } },
          _count: { select: { topics: true } },
        },
      },
    },
  });
}

export async function getStudentCourse(organizationId: string, studentId: string, courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId, status: CourseStatus.PUBLISHED },
    include: {
      instructors: { select: { instructor: { select: { name: true } } }, orderBy: { assignedAt: 'asc' } },
      topics: { orderBy: { order: 'asc' } },
      enrollments: {
        where: { studentId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] } },
        select: { id: true, status: true, enrolledAt: true },
        take: 1,
      },
      notes: {
        where: { organizationId, published: true, deletedAt: null },
        select: { id: true, title: true, subject: true, description: true, originalName: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });
  if (!course) throw new HttpError(404, 'Course not found');
  const coveredTopics = course.topics.filter((topic) => topic.covered).length;
  return {
    ...course,
    progressPercent: course.topics.length === 0 ? 0 : Math.round((coveredTopics / course.topics.length) * 100),
    assessments: await prisma.assessment.findMany({
      where: { organizationId, courseId, status: AssessmentStatus.PUBLISHED },
      select: { id: true, title: true, instructions: true, totalMarks: true, passMark: true, durationMinutes: true, opensAt: true, closesAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  };
}

export async function enrollStudent(organizationId: string, studentId: string, actorId: string, courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId, status: CourseStatus.PUBLISHED },
    select: { id: true, code: true },
  });
  if (!course) throw new HttpError(404, 'Course not found');
  const existing = await prisma.enrollment.findUnique({
    where: { organizationId_courseId_studentId: { organizationId, courseId, studentId } },
  });
  if (existing && existing.status !== EnrollmentStatus.DROPPED) throw new HttpError(409, 'You are already enrolled in this course');
  const status = env.REQUIRE_ENROLLMENT_APPROVAL ? EnrollmentStatus.PENDING : EnrollmentStatus.ACTIVE;
  try {
    return await prisma.$transaction(async (tx) => {
      const enrollment = existing
        ? await tx.enrollment.update({
          where: { id: existing.id },
          data: { status, enrolledAt: new Date(), completedAt: null },
          select: { id: true, status: true, enrolledAt: true },
        })
        : await tx.enrollment.create({
          data: { organizationId, courseId, studentId, status },
          select: { id: true, status: true, enrolledAt: true },
        });
      await audit(tx, organizationId, actorId, 'COURSE_ENROLLED', 'Enrollment', enrollment.id, { courseId, status });
      return enrollment;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'You are already enrolled in this course');
    }
    throw error;
  }
}

export async function dropStudentCourse(organizationId: string, studentId: string, actorId: string, courseId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      organizationId,
      courseId,
      studentId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] },
      course: { status: CourseStatus.PUBLISHED },
    },
  });
  if (!enrollment) throw new HttpError(404, 'Active course enrollment not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: EnrollmentStatus.DROPPED, completedAt: null },
      select: { id: true, status: true, enrolledAt: true },
    });
    await audit(tx, organizationId, actorId, 'COURSE_DROPPED', 'Enrollment', enrollment.id, { courseId });
    return updated;
  });
}

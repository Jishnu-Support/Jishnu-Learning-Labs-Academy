import { CourseStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

const courseFields = { id: true, title: true, description: true, status: true, createdAt: true, updatedAt: true } as const;

export function listCourses(instructorId: string) {
  return prisma.course.findMany({ where: { instructorId }, orderBy: { updatedAt: 'desc' }, select: courseFields });
}

export async function getCourse(instructorId: string, courseId: string) {
  const course = await prisma.course.findFirst({ where: { id: courseId, instructorId }, select: courseFields });
  if (!course) throw new HttpError(404, 'Course not found');
  return course;
}

export function createCourse(instructorId: string, input: { title: string; description?: string }) {
  return prisma.course.create({ data: { instructorId, title: input.title, description: input.description }, select: courseFields });
}

export async function updateCourse(instructorId: string, courseId: string, input: { title?: string; description?: string | null }) {
  const existing = await getCourse(instructorId, courseId);
  return prisma.course.update({ where: { id: existing.id }, data: input, select: courseFields });
}

export async function setCourseStatus(instructorId: string, courseId: string, status: CourseStatus) {
  const existing = await getCourse(instructorId, courseId);
  return prisma.course.update({ where: { id: existing.id }, data: { status }, select: courseFields });
}

export async function deleteCourse(instructorId: string, courseId: string): Promise<void> {
  const existing = await getCourse(instructorId, courseId);
  if (existing.status !== CourseStatus.DRAFT) throw new HttpError(409, 'Unpublish the course before deleting it');
  const deleted = await prisma.course.deleteMany({
    where: { id: existing.id, instructorId, status: CourseStatus.DRAFT },
  });
  if (deleted.count !== 1) throw new HttpError(409, 'Unpublish the course before deleting it');
}

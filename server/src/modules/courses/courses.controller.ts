import { CourseStatus } from '@prisma/client';
import type { RequestHandler } from 'express';
import * as service from './courses.service.js';

export const list: RequestHandler = async (req, res) => {
  res.json({ data: { courses: await service.listCourses(req.auth!.userId) } });
};

export const get: RequestHandler = async (req, res) => {
  res.json({ data: { course: await service.getCourse(req.auth!.userId, req.params.courseId as string) } });
};

export const create: RequestHandler = async (req, res) => {
  const course = await service.createCourse(req.auth!.userId, req.body);
  res.status(201).json({ data: { course } });
};

export const update: RequestHandler = async (req, res) => {
  const course = await service.updateCourse(req.auth!.userId, req.params.courseId as string, req.body);
  res.json({ data: { course } });
};

export const publish: RequestHandler = async (req, res) => {
  const course = await service.setCourseStatus(req.auth!.userId, req.params.courseId as string, CourseStatus.PUBLISHED);
  res.json({ data: { course } });
};

export const unpublish: RequestHandler = async (req, res) => {
  const course = await service.setCourseStatus(req.auth!.userId, req.params.courseId as string, CourseStatus.DRAFT);
  res.json({ data: { course } });
};

export const remove: RequestHandler = async (req, res) => {
  await service.deleteCourse(req.auth!.userId, req.params.courseId as string);
  res.status(204).end();
};

import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import {
  courseListQuerySchema,
  enrollmentListQuerySchema,
  studentCourseListQuerySchema,
} from './courses.schemas.js';
import * as service from './courses.service.js';

function courseId(req: Request): string {
  const value = req.params.courseId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid course ID');
  return value;
}

function topicId(req: Request): string {
  const value = req.params.topicId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid topic ID');
  return value;
}

function enrollmentId(req: Request): string {
  const value = req.params.enrollmentId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid enrollment ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({
    data: {
      courses: await service.listCourses(
        getOrganizationId(req),
        req.auth!.userId,
        req.auth!.role,
        courseListQuerySchema.parse(req.query),
      ),
    },
  });
};

export const instructors: RequestHandler = async (req, res) => {
  res.json({
    data: {
      instructors: await service.listAssignableInstructors(getOrganizationId(req), req.auth!.userId, req.auth!.role),
    },
  });
};

export const get: RequestHandler = async (req, res) => {
  res.json({
    data: {
      course: await service.getManagedCourse(getOrganizationId(req), req.auth!.userId, req.auth!.role, courseId(req)),
    },
  });
};

export const create: RequestHandler = async (req, res) => {
  const course = await service.createCourse(getOrganizationId(req), req.auth!.userId, req.auth!.role, req.body);
  res.status(201).json({ data: { course } });
};

export const update: RequestHandler = async (req, res) => {
  const course = await service.updateCourse(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.role,
    courseId(req),
    req.body,
  );
  res.json({ data: { course } });
};

export const publish: RequestHandler = async (req, res) => {
  const course = await service.publishCourse(getOrganizationId(req), req.auth!.userId, req.auth!.role, courseId(req));
  res.json({ data: { course } });
};

export const archive: RequestHandler = async (req, res) => {
  const course = await service.archiveCourse(getOrganizationId(req), req.auth!.userId, req.auth!.role, courseId(req));
  res.json({ data: { course } });
};

export const addTopic: RequestHandler = async (req, res) => {
  const topic = await service.createTopic(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.role,
    courseId(req),
    req.body,
  );
  res.status(201).json({ data: { topic } });
};

export const reorderTopics: RequestHandler = async (req, res) => {
  const course = await service.reorderTopics(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.role,
    courseId(req),
    req.body.topicIds,
  );
  res.json({ data: { course } });
};

export const updateTopic: RequestHandler = async (req, res) => {
  const topic = await service.setTopicCovered(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.role,
    courseId(req),
    topicId(req),
    req.body.covered,
  );
  res.json({ data: { topic } });
};

export const enrollments: RequestHandler = async (req, res) => {
  res.json({
    data: {
      enrollments: await service.listEnrollments(
        getOrganizationId(req),
        req.auth!.userId,
        req.auth!.role,
        courseId(req),
        enrollmentListQuerySchema.parse(req.query).search,
      ),
    },
  });
};

export const approveEnrollment: RequestHandler = async (req, res) => {
  const enrollment = await service.approveEnrollment(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.role,
    courseId(req),
    enrollmentId(req),
  );
  res.json({ data: { enrollment } });
};

export const studentBrowse: RequestHandler = async (req, res) => {
  res.json({
    data: {
      courses: await service.browseStudentCourses(
        getOrganizationId(req),
        req.auth!.userId,
        studentCourseListQuerySchema.parse(req.query).search,
      ),
    },
  });
};

export const studentEnrolled: RequestHandler = async (req, res) => {
  res.json({ data: { enrollments: await service.listStudentEnrollments(getOrganizationId(req), req.auth!.userId) } });
};

export const studentGet: RequestHandler = async (req, res) => {
  res.json({
    data: { course: await service.getStudentCourse(getOrganizationId(req), req.auth!.userId, courseId(req)) },
  });
};

export const studentEnroll: RequestHandler = async (req, res) => {
  const enrollment = await service.enrollStudent(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.userId,
    courseId(req),
  );
  res.status(201).json({ data: { enrollment } });
};

export const studentDrop: RequestHandler = async (req, res) => {
  const enrollment = await service.dropStudentCourse(
    getOrganizationId(req),
    req.auth!.userId,
    req.auth!.userId,
    courseId(req),
  );
  res.json({ data: { enrollment } });
};

import type { RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import { deleteTutorReviewSchema, hideTutorReviewSchema, tutorCourseQuerySchema, tutorListQuerySchema } from './tutor.schemas.js';
import * as tutorService from './tutor.service.js';

function userId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.userId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid Tutor ID');
  return value;
}

export const list: RequestHandler = async (req, res) => {
  res.json({ data: await tutorService.listTutor(
    getOrganizationId(req),
    tutorListQuerySchema.parse(req.query),
    req.auth!.userId,
    req.auth!.role,
  ) });
};

export const available: RequestHandler = async (req, res) => {
  const { courseId } = tutorCourseQuerySchema.parse(req.query);
  res.json({ data: await tutorService.listAvailableTutors(getOrganizationId(req), req.auth!.userId, courseId) });
};

export const preferred: RequestHandler = async (req, res) => {
  const { courseId } = tutorCourseQuerySchema.parse(req.query);
  if (!courseId) throw new HttpError(400, 'Course ID is required');
  res.json({ data: { tutor: await tutorService.getPreferredTutor(getOrganizationId(req), req.auth!.userId, courseId) } });
};

export const selectPreferred: RequestHandler = async (req, res) => {
  res.json({
    data: {
      ...(await tutorService.selectPreferredTutor(getOrganizationId(req), req.auth!.userId, req.body.courseId, req.body.tutorId)),
    },
  });
};

export const submitReview: RequestHandler = async (req, res) => {
  res.json({
    data: {
      review: await tutorService.submitTutorReview(
        getOrganizationId(req),
        req.auth!.userId,
        userId(req),
        req.body,
      ),
    },
  });
};

export const deleteReview: RequestHandler = async (req, res) => {
  const { courseId } = deleteTutorReviewSchema.parse(req.body);
  await tutorService.deleteTutorReview(getOrganizationId(req), req.auth!.userId, userId(req), courseId);
  res.status(204).end();
};

export const ratingDashboard: RequestHandler = async (req, res) => {
  res.json({
    data: {
      ratings: await tutorService.tutorRatingDashboard(
        getOrganizationId(req),
        userId(req),
        req.auth!.userId,
        req.auth!.role,
      ),
    },
  });
};

export const organizationReviews: RequestHandler = async (req, res) => {
  res.json({ data: { reviews: await tutorService.listOrganizationTutorReviews(getOrganizationId(req)) } });
};

export const setReviewVisibility: RequestHandler = async (req, res) => {
  const value = req.params.reviewId;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid review ID');
  const { hidden, reason } = hideTutorReviewSchema.parse(req.body);
  res.json({
    data: {
      review: await tutorService.setTutorReviewVisibility(getOrganizationId(req), value, req.auth!.userId, hidden, reason),
    },
  });
};

export const reviews: RequestHandler = async (req, res) => {
  res.json({
    data: {
      reviews: await tutorService.listTutorReviews(
        getOrganizationId(req),
        userId(req),
        req.auth!.userId,
        req.auth!.role,
      ),
    },
  });
};

export const get: RequestHandler = async (req, res) => {
  res.json({
    data: {
      tutor: await tutorService.getTutor(getOrganizationId(req), userId(req), req.auth!.userId, req.auth!.role),
    },
  });
};

export const create: RequestHandler = async (req, res) => {
  const result = await tutorService.createTutor(getOrganizationId(req), req.auth!.userId, req.body);
  res.status(201).json({ data: result });
};

export const update: RequestHandler = async (req, res) => {
  res.json({
    data: {
      tutor: await tutorService.updateTutor(getOrganizationId(req), userId(req), req.auth!.userId, req.body),
    },
  });
};

export const suspend: RequestHandler = async (req, res) => {
  res.json({ data: { tutor: await tutorService.suspendTutor(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

export const reactivate: RequestHandler = async (req, res) => {
  res.json({ data: { tutor: await tutorService.reactivateTutor(getOrganizationId(req), userId(req), req.auth!.userId) } });
};

export const uploadPhoto: RequestHandler = async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Select an image file');
  const result = await tutorService.uploadTutorPhoto(
    getOrganizationId(req),
    userId(req),
    req.auth!.userId,
    req.auth!.role,
    req.file.buffer,
  );
  res.json({ data: result });
};

export const photo: RequestHandler = async (req, res) => {
  const file = await tutorService.getTutorPhoto(getOrganizationId(req), userId(req), req.auth!.userId, req.auth!.role);
  res.set({ 'Content-Type': file.mimeType, 'Content-Length': String(file.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  file.stream.pipe(res);
};

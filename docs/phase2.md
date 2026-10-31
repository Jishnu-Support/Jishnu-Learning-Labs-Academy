# Phase 2: Instructor course authoring

Phase 2 adds the instructor course studio for creating and managing course outlines. It does not add lessons or media content; those belong to Course Management in a later phase.

## Course model

Each course belongs to one instructor and has a title, optional description, `DRAFT` or `PUBLISHED` status, and timestamps. Instructors can only list, read, update, publish, unpublish, or delete their own courses. Published courses must be unpublished before deletion.

## API

- `GET /api/instructor/courses`
- `POST /api/instructor/courses`
- `GET /api/instructor/courses/:courseId`
- `PATCH /api/instructor/courses/:courseId`
- `POST /api/instructor/courses/:courseId/publish`
- `POST /api/instructor/courses/:courseId/unpublish`
- `DELETE /api/instructor/courses/:courseId` (drafts only)

All endpoints require an authenticated instructor. Request bodies and course IDs are validated with Zod, and ownership is checked in the service layer.

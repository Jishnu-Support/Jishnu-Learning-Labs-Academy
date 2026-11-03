# Part B: Upload, Processing and Management of Video and Audio

## Scope and workflow

Part A (12 demo courses) is done and committed. This is the full Part B specification. Do not look for an older plan; use only this text.

### Step 1

Save this whole specification as `docs/part-b-media-plan.md` in the repository (so it is not lost again), then show a short implementation plan (schema, routes, jobs, pages, files, new packages) and wait for my "go ahead". Do not write any feature code before I approve.

### General rules

- Keep the same-origin `/api` setup, organization scoping on every query, backend permission checks, Zod validation, `AuditLog` entries, the `PageHeader` back-button rule and the Jishnu theme.
- Do not reset the database or delete any data. If Prisma asks for a reset, stop and ask me.
- Ask me before installing anything other than the npm packages `ffmpeg-static`, `ffprobe-static` and small helpers such as `file-type`; do not install system software.
- Build Part B only. Do not build student playback (that is Part C).

## Part B requirements

### Permissions

- `STAFF`, `INSTRUCTOR` and `ORG_ADMIN` can upload and manage media.
- Staff and instructors edit, publish, unpublish and delete only their own uploads; `ORG_ADMIN` manages all media of the organization.
- Students can never upload.
- Every route checks role and organization on the backend.

### Schema (forward-only migration)

- `MediaItem`: `organizationId`, required `courseId`, optional `topicId`, `title`, `description`, `type` (`VIDEO` / `AUDIO`), `status` (`UPLOADING` / `PROCESSING` / `READY` / `FAILED`), `visibility` (`DRAFT` / `PUBLISHED`), `durationSeconds`, `sizeBytes`, `originalKey`, `streamKey` (HLS manifest folder or processed audio), `thumbnailKey`, `uploadedBy`, `publishedAt`, soft delete, `createdAt`.
- `MediaJob` (database-backed job queue): `mediaId`, `status`, `attempts`, `error`, `startedAt`, `finishedAt`.
- Per-organization storage usage is a computed total with a quota setting (default 10 GB) and per-file limits `MAX_VIDEO_MB` (default 500) and `MAX_AUDIO_MB` (default 100), all configurable through environment variables documented in `.env.example`.
- `WatchProgress`: `studentId`, `mediaId`, `lastPositionSeconds`, `watchedSeconds`, `completed`, `updatedAt`. Create the table now; it is used in Part C.

### Upload

- Add an "Upload Media" page in the Staff portal and the same page for Instructor and Org Admin, plus a "My Uploads" list.
- The form has title, description, course, optional topic, type, and a drag-and-drop file picker with a progress bar, cancel and retry.
- Allowed types, validated by extension, MIME type and file signature (magic bytes): video MP4, MOV, WebM, MKV; audio MP3, M4A, AAC, WAV, OGG.
- Reject everything else, enforce size limits and quota, rate limit uploads, use random storage keys (no user-supplied filenames in paths), and clean up partial uploads.
- Use the existing `StorageService` abstraction (local disk, outside the web root) so S3 or R2 can replace it later.
- Stream large uploads to disk; never load them into memory.

### Processing

- A background worker (database-backed queue, one job at a time, retries with backoff, recovery of jobs left in `PROCESSING` after a restart) converts videos with FFmpeg to HLS (720p and 480p renditions, AES-128 encrypted segments, the key served only through an authenticated endpoint), extracts a thumbnail and duration (ffprobe).
- Audio is normalized to AAC/M4A and its duration stored.
- Use the `ffmpeg-static` and `ffprobe-static` npm packages so nothing has to be installed manually on Windows.
- Document that production needs FFmpeg on the server or a managed service (Mux, Cloudflare Stream, AWS MediaConvert), and keep processing behind a `MediaProcessor` interface so it can be swapped.
- Show status in the list: Uploading, Processing with progress, Ready, Failed with the error and a Retry button.
- Delete the original after successful processing only if `KEEP_ORIGINAL_MEDIA` is false (default true).

### Management

- Edit title, description, course and topic; publish and unpublish (publish only when status is `READY`); soft delete with confirmation.
- Add a preview player for the uploader.
- Add filters by course, type and status, and search by title.
- The Org Admin sees a storage usage bar.

### Development sample script

Add a development script (`npm run media:sample`) that uses FFmpeg to generate a 10-second sample video and a 10-second audio tone locally and registers them for a few courses, so no large binary files are committed.

### Tests

- Permissions: students get 403 on upload, edit and delete; staff cannot edit another person's media; organization isolation, including manifest, segment and key routes returning 404 for other organizations.
- Upload validation: wrong type, a renamed file with the wrong signature, over the size limit, over the quota, path traversal attempts.
- Processing: job lifecycle, retry, failure, recovery after a restart (mock FFmpeg in unit tests; one optional integration test with the sample files).
- Component tests for the upload form, progress and the status list.

## Completion

After my "go ahead": run lint, type-check and tests, fix failures, commit, then give me:

1. The exact commands to migrate and restart.
2. The `npm run media:sample` command.
3. A step-by-step manual test: log in as staff, upload a small video and an audio, watch processing reach Ready, publish them to a course, then edit, unpublish and delete one.

Then stop and wait for me to say "start Part C".

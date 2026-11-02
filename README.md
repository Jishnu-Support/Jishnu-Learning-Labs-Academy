# Jishnu Learning Labs

Jishnu Learning Labs is a multi-organization learning platform. Each organization has isolated users and data. Checkpoint 1A delivers the tenant-aware database/authentication foundation, organization registration, and approval flows. Checkpoint 1B adds staff management, student/staff directories, and protected notes. Checkpoint 2A adds tenant-scoped courses, topics, student enrollment, and course-linked notes. Assessment and practice records are seeded for future modules; assessment attempts are not included here.

## Requirements

- Node.js 24 and npm
- Local PostgreSQL listening on port 5432
- Windows PowerShell
- No Docker, Redis, or BullMQ

## Local databases

Create these databases in pgAdmin:

- `jishnu_learning_labs` for development
- `jishnu_learning_labs_test` for tests; keep it separate and disposable

Do not reset or manually edit either database. Prisma migrations manage schema changes. Migrations are forward-only and preserve existing data. The multi-tenant migration backfills existing tenant records into a legacy organization instead of deleting existing data.

## Environment setup

From PowerShell in the repository root:

```powershell
if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
if (-not (Test-Path .\client\.env)) { Copy-Item .\client\.env.example .\client\.env }
```

Edit `server/.env` with the local PostgreSQL connection strings. Set `DATABASE_URL` to `jishnu_learning_labs` and `TEST_DATABASE_URL` to `jishnu_learning_labs_test`. Keep both URLs and JWT secrets private. `REQUIRE_ENROLLMENT_APPROVAL=false` allows students to enroll immediately; set it to `true` to create pending enrollments for course staff to approve. Generate two different JWT secrets (at least 32 characters) with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Put each result in a different JWT secret variable. Set `REQUIRE_ORG_APPROVAL=false` for immediate activation (the default); set it to `true` only when organization registrations should wait for Super Admin approval. Set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` for the seeded platform administrator. `SEED_PASSWORD` controls the other development accounts. `NOTE_STORAGE_DIR` defaults to `storage/notes` under the server working directory; configure an absolute private directory if needed. The example values are local development credentials only.

## Install, migrate, and seed

```powershell
Set-Location "D:\Learning labs"
npm install
npm run prisma:generate --workspace server
Set-Location .\server
npx prisma migrate deploy
Set-Location ..
npm run db:seed --workspace server
```

`migrate deploy` applies pending migrations without resetting or dropping application tables. If Prisma reports a migration error, stop and investigate; do not reset the database. The seed is idempotent and prints its development-only credentials and organization codes; it does not delete old records.

## Run locally

Open two PowerShell terminals in `D:\Learning labs`.

Terminal 1:

```powershell
npm run dev:server
```

Terminal 2:

```powershell
npm run dev:client
```

Open `http://localhost:5173`. All portals share that host:

- Student: `/student/login`
- Instructor: `/instructor/login`
- Staff: `/staff/login`
- Org Admin: `/org-admin/login`
- Super Admin: `/super-admin/login`

The client uses the same-origin `/api` path. Vite proxies it to the local API on port 4000 during development, so browser login and API requests stay on the frontend host. For a single-domain deployment, configure the platform's reverse proxy to serve the frontend and forward `/api` to the backend; keep `VITE_API_URL=/api`. The API health endpoint is available at `http://localhost:4000/api/health` during local development.

## Video and audio media (Part B)

Staff and instructors can upload and manage their own course media; Org Admins can manage all media for their organization. Uploads are streamed to private storage outside the client web root, validated by extension, MIME type and file signature, then processed by the server's background worker. The uploader can preview, edit, publish, unpublish and soft-delete media. Student playback is not part of Part B.

`server/.env.example` documents the media configuration:

- `MEDIA_STORAGE_DIR` defaults to `storage/media` under the server working directory. Use a private path outside any public web root.
- `MEDIA_STORAGE_QUOTA_GB` defaults to 10 GB per organization.
- `MAX_VIDEO_MB` defaults to 500 MB and `MAX_AUDIO_MB` to 100 MB.
- `KEEP_ORIGINAL_MEDIA` defaults to `true`; set it to `false` to remove the source after successful processing.
- `MEDIA_PROCESSING_MAX_ATTEMPTS` defaults to 3.

Install dependencies and apply the forward-only schema migration before starting the server:

```powershell
Set-Location "D:\Learning labs"
npm install
npm run prisma:generate --workspace server
Set-Location .\server
npx prisma migrate deploy
Set-Location ..
npm run dev:server
```

In another PowerShell terminal, start the frontend with `npm run dev:client`. To generate and queue small local video/audio samples for the seeded `jll-demo` courses, run `npm run media:sample` after seeding. The script is safe to rerun and does not delete media or other database data.

Video processing uses bundled FFmpeg to create encrypted HLS renditions and a thumbnail; audio is normalized to AAC/M4A. Production deployments need a compatible FFmpeg binary on the server or a managed media service such as Mux, Cloudflare Stream, or AWS MediaConvert. The media storage adapter is isolated behind a streaming-capable interface so a private object-storage adapter can replace local disk. Do not expose the media storage directory through a static web server; playback and encryption keys are available only through authenticated API routes.

## Brand theme and welcome intro

The client uses the Jishnu Learning Labs brand palette, shared logo, responsive portal styling, and a seven-second welcome intro. The intro appears once per browser session on the first root or login page visit; it is skipped for authenticated users and is not replayed on later routes. The Skip control appears after one second, and Escape also skips it.

Sound is synthesized locally with the Web Audio API by default. `client/src/lib/brand-config.ts` contains the intro copy, shared animation/sound cue timings, and these options:

- `INTRO_SOUND_ENABLED` enables or disables intro sound.
- `INTRO_SOUND_SOURCE` is `synth` by default. Set it to `file` to use `client/public/brand/intro-chime.mp3`; a missing or unreadable file falls back to the synth.
- `INTRO_REQUIRE_TAP` defaults to `false`. Set it to `true` to require the branded Enter button, which starts the animation and sound from the same user gesture.

Browsers may block audio started without a user gesture. When that happens, the intro continues silently and offers a “Tap for sound” control; later cues are synchronized to the current point in the animation. The mute preference is stored in browser `localStorage` under `jll-intro-sound`. Reduced-motion mode uses a short fade and does not play audio.

Only use an intro audio file that you own or are licensed to use, and keep its license and attribution with the asset. Do not add a third-party audio file without confirming its redistribution and commercial-use terms.

## Seed accounts (development only)

The platform administrator uses `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` from `server/.env` (the example defaults are `admin@jishnu.local` and `JishnuDevOnly!2026`). Other seeded accounts use `SEED_PASSWORD`, or `JishnuDevOnly!2026` if unset. The seed prints the actual development-only credentials and organization codes in PowerShell.

For local development only, set `VITE_SHOW_DEMO_LOGINS=true` in `client/.env` to show the matching demo account and a fill-in button on each login page. Keep `VITE_DEMO_PASSWORD`, `VITE_DEMO_SUPER_ADMIN_EMAIL`, and `VITE_DEMO_SUPER_ADMIN_PASSWORD` in sync with the seed settings in `server/.env`. The credential panel is hidden from production builds; never use demo credentials outside local development.

| Portal | Sign-in identifier | Organization code |
|---|---|---|
| Super Admin | `SUPER_ADMIN_EMAIL` (default `admin@jishnu.local`) | Not required |
| Org Admin | `orgadmin@jll-demo.local` | `jll-demo` |
| Instructor | `instructor1@jll-demo.local`, `instructor2@jll-demo.local` | `jll-demo` |
| Staff | `STF-1001`, `STF-1002` | `jll-demo` |
| Student | `STU-1001` through `STU-1006` | `jll-demo` |
| Northstar Org Admin | `orgadmin@northstar.local` | `northstar-academy` |
| Northstar Instructor | `instructor@northstar.local` | `northstar-academy` |
| Northstar Staff | `STF-2001`, `STF-2002` | `northstar-academy` |
| Northstar Students | `STU-1001`, `NST-2002` | `northstar-academy` |

The same `STU-1001` exists in both organizations to demonstrate tenant-scoped IDs. Both demo organizations are active and have two instructors and two staff accounts. Existing records from earlier seed versions are preserved.

## Registration and approval flow

- An organization registers at `/organizations/register`. By default, registration activates it immediately, creates its Org Admin, and displays its unique organization code. `REQUIRE_ORG_APPROVAL=true` restores a pending Super Admin approval flow.
- Super Admin monitors organizations at `/super-admin/organizations` and can suspend or reactivate them. Organization summaries show role counts only, not internal student records.
- Instructor and self-registering staff accounts are approved by the Org Admin of the same organization.
- Students are approved by an instructor in the same organization.
- Instructors are approved by the Org Admin of the same organization.
- Only approved accounts can sign in. Pending, rejected (including the reason), and suspended accounts receive distinct messages.
- Super Admin accounts are created only by the seed script.
- Students have one active session; signing in again revokes the earlier session.
- Approval, rejection, and account creation actions are written to `AuditLog`.
- Staff and student approval routes are backend-protected; Staff and Students receive 403 responses.
- Organization registration is rate-limited per IP and rejects duplicate organization email. Add email verification and CAPTCHA before production use.

## Checkpoint 1B organization modules

- **Create Staff** is Org Admin-only. Created accounts are approved, receive a temporary password once, and are required to change it at first sign-in. The API blocks other authenticated actions until the password is changed.
- **Student Details** is available to Org Admins, instructors, and staff. Search matches Student ID and name; results are tenant-scoped, filterable, and paginated. Student detail shows safe profile fields plus the last 10 successful login timestamps. Org Admins and instructors can suspend/reactivate students; staff are read-only.
- **Staff Details** is available to Org Admins and instructors. Search matches Staff ID and name; results are tenant-scoped, filterable, and paginated. Org Admins can edit, suspend, and reactivate staff.
- **Publish Notes** is available to Org Admins, instructors, and staff. Each can create and publish notes; Org Admins can manage any organization note, while instructors/staff can edit, unpublish, or soft-delete only their own notes. Staff and instructors see published notes and their own drafts.
- Note attachments are limited to PDF, PNG, JPG, and WEBP, at most 20 MB, and the extension must match the MIME type. DOC/DOCX/PPT/PPTX files must be converted to PDF before uploading.
- Local files are stored outside the client web root in `NOTE_STORAGE_DIR`; all views and downloads use authenticated routes. The `StorageService` abstraction is the replacement point for a private S3 or Cloudflare R2 adapter.
- Students see only published notes. Their viewer streams attachments inline through an authenticated endpoint, renders PDFs with PDF.js and images in-page, overlays the student's name and ID on every page, and omits download/print controls. View events are recorded. Browser controls cannot fully prevent screenshots or saving; the watermark and viewer restrictions are deterrents. DRM would be a stronger future option.

## Checkpoint 2A courses and enrollment

- Org Admins manage courses for their organization; Instructors can manage only courses assigned to them. Course codes are unique within each organization.
- Course pages support instructor assignment, planned hours and completion rules, topic creation/reordering/coverage, publishing, archiving, student search, and linked notes.
- Students can browse only published courses in their organization, enroll, view course progress and notes, and drop active enrollment. Enrollment approvals are optional and default off through `REQUIRE_ENROLLMENT_APPROVAL`.
- The seed provides 12 published courses per demo organization: SAP101, ENG101, TAM101, MAT101, SOC101, SCI101, PY101, CPP101, JAV101, JS101, HTML101, and CSS101. Each has subject-specific practice questions for single- and multiple-answer MCQ, True/False, Match, and Fill in the blanks, plus a published assessment, linked notes, and demo enrollment/progress. Course fixture seeding is additive and idempotent: it preserves existing course, topic, enrollment, note, and user edits; an existing course's status alone is restored to PUBLISHED.
- Student course pages show assessment titles and summary metadata only; assessment attempts and grading are not part of this checkpoint.

## API endpoints

- `POST /api/organizations/register`
- `GET /api/super-admin/organizations` (summary list and optional `?search=`; does not expose student records)
- `GET /api/super-admin/organizations/pending` (approval-mode registrations)
- `POST /api/super-admin/organizations/:organizationId/approve`
- `POST /api/super-admin/organizations/:organizationId/reject`
- `POST /api/super-admin/organizations/:organizationId/suspend` and `/reactivate`
- `POST /api/auth/students/register`, `/api/auth/instructors/register`, `/api/auth/staff/register`
- `POST /api/auth/students/login`, `/api/auth/instructors/login`, `/api/auth/staff/login`
- `POST /api/auth/org-admin/login`, `/api/auth/super-admin/login`
- `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/org-admin/instructors/pending` and `/api/org-admin/staff/pending`
- `POST /api/org-admin/instructors/:userId/approve` and `/reject`
- `POST /api/org-admin/staff/:userId/approve` and `/reject`
- `GET /api/instructor/registrations/pending`
- `POST /api/instructor/registrations/:studentId/approve` and `/reject`
- `GET /api/students` (scoped to the authenticated organization)
- `GET /api/students?search=&status=&page=&pageSize=`
- `GET /api/students/:studentId` (safe profile and last 10 successful login timestamps)
- `POST /api/students/:studentId/suspend` and `/reactivate` (Org Admin or Instructor)
- `GET /api/staff?search=&status=&page=&pageSize=` and `GET /api/staff/:userId`
- `POST /api/staff` (Org Admin creates an approved staff account; temporary password returned once)
- `PATCH /api/staff/:userId`, `POST /api/staff/:userId/suspend`, and `/reactivate` (Org Admin)
- `POST /api/auth/change-password` (required for staff created with temporary passwords)
- `GET /api/notes?search=&subject=`, `POST /api/notes`, `PATCH /api/notes/:noteId`, `DELETE /api/notes/:noteId`
- `POST /api/notes/:noteId/publish` and `/unpublish`
- `GET /api/notes/:noteId/view` (authenticated inline viewer; student access only to published notes)
- `GET /api/notes/:noteId/download` (Org Admin, Instructor, and Staff only)
- `GET /api/courses`, `POST /api/courses`, `GET /api/courses/:courseId`, and `PATCH /api/courses/:courseId` (Org Admin or assigned Instructor)
- `GET /api/courses/instructors`, `POST /api/courses/:courseId/publish`, `POST /api/courses/:courseId/archive`
- `POST /api/courses/:courseId/topics`, `PATCH /api/courses/:courseId/topics/reorder`, and `PATCH /api/courses/:courseId/topics/:topicId`
- `GET /api/courses/:courseId/enrollments?search=` and `POST /api/courses/:courseId/enrollments/:enrollmentId/approve`
- `GET /api/student/courses/browse?search=`, `GET /api/student/courses/enrolled`, `GET /api/student/courses/:courseId`
- `POST /api/student/courses/:courseId/enroll` and `/drop`

Access and refresh tokens are sent only in httpOnly cookies. Every tenant login requires an organization code; Super Admin login does not.

## Test and quality checks

Apply pending migrations to the dedicated test database before running tests:

```powershell
Set-Location "D:\Learning labs\server"
$testLine = Get-Content .env | Where-Object { $_ -match '^TEST_DATABASE_URL=' } | Select-Object -First 1
$env:DATABASE_URL = $testLine.Substring('TEST_DATABASE_URL='.Length)
npx prisma migrate deploy
Remove-Item Env:DATABASE_URL
Set-Location ..
npm test
npm run lint
npm run typecheck
```

Server tests use `TEST_DATABASE_URL`, create uniquely named fixtures, and remove only those fixtures. Never point it at the development database.

## Checkpoint scope

- 1A: multi-tenant schema/migration, authentication, organization registration, approval flows, seed, and tests.
- 1B: Create Staff with forced first-login password change, Student/Staff Details, and Publish Notes with private storage and student view-only protection.
- 1C: Expert Sessions, Assessments, Practice Q/A, and final tests.
- 2A: tenant-scoped Courses, topics, enrollment, linked notes, and seeded assessment/practice examples. Course tests use the dedicated test database.

The Jitsi implementation planned for 1C is a basic live-class integration; it is not DRM and cannot prevent screen recording or screenshots.

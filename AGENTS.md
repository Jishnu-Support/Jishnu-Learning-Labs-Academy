# AGENTS.md: Jishnu Learning Labs Platform

## Project overview
Jishnu Learning Labs is a multi-organization learning platform. Each organization has isolated users and portal data. Build only the approved phase and checkpoint; do not add courses, video libraries, payments, certificates, or reports unless a later phase explicitly requests them.

## Stack and local development
- Frontend: React, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form, and Zod in `/client`.
- Backend: Node.js, Express, TypeScript, Prisma, and Zod in `/server`.
- Database: shared PostgreSQL database with Prisma migrations. Never modify the database by hand.
- Local development uses PostgreSQL on Windows/PowerShell. Do not introduce Docker, Redis, or BullMQ.
- Authentication: bcrypt password hashes and JWT access/refresh tokens in secure, httpOnly cookies.
- Tests: Vitest and Supertest. Use the existing lint, formatting, and type-check commands.

## Tenancy and roles
- Roles: `SUPER_ADMIN`, `ORG_ADMIN`, `INSTRUCTOR`, `STAFF`, and `STUDENT`.
- Every tenant-owned record must be associated with an `organizationId`. Derive tenant scope from the authenticated identity; never trust a client-supplied organization ID for authorization.
- Every tenant-scoped read and write must enforce organization ownership on the backend. Data belonging to one organization must never be visible or mutable by another.
- Student IDs and Staff IDs are unique within an organization, not globally.
- Organization codes are unique, URL-safe, and required at login for tenant accounts. `SUPER_ADMIN` does not use an organization code.
- Account statuses are `PENDING`, `APPROVED`, `REJECTED`, and `SUSPENDED`. Only `APPROVED` accounts may log in; return a clear status-specific message otherwise.
- Organization registration activates immediately by default, generates a unique organization code, and creates its approved `ORG_ADMIN` in one transaction. `REQUIRE_ORG_APPROVAL=true` is the explicit opt-in exception.
- Organization states include `ACTIVE`, `PENDING`, `REJECTED`, and `SUSPENDED`. Suspended organizations cannot authenticate or use protected sessions.
- Students have one active session; a successful new login revokes the prior student session.
- `SUPER_ADMIN` is created only by the seed script. No user may approve their own account.

## Approval rules
- Only `SUPER_ADMIN` may monitor and suspend/reactivate organizations; organization registration does not require approval unless `REQUIRE_ORG_APPROVAL=true`.
- Only an organization's `ORG_ADMIN` may approve or reject its instructor and self-registered staff registrations.
- Only an organization's `INSTRUCTOR` may approve or reject student registrations.
- `ORG_ADMIN` can create approved staff accounts with a temporary password that must be changed on first login.
- Staff and students cannot approve accounts. Enforce all approval rules in backend authorization, including 403 responses for disallowed actions.
- Record an `AuditLog` entry, including `organizationId` when applicable, for approvals, rejections, suspensions, account creation, and other sensitive actions.

## Architecture and implementation
- Keep the layering: route -> controller -> service -> database. Do not put business logic in routes.
- Validate every request with Zod and return consistent, explicit error responses.
- Use strict TypeScript. Avoid `any` unless unavoidable and documented.
- Enforce role checks and organization ownership on every protected backend route; frontend checks are not authorization.
- Use Prisma migrations for schema changes. Never reset or delete development data without warning the user first and receiving approval.
- Keep changes focused, follow existing naming and formatting, and add or update tests for each feature.
- Keep upload storage behind an abstraction. Local files must be outside the web root and available only through authenticated routes.
- For Checkpoint 1B notes, allow only PDF and PNG/JPG/WEBP attachments up to 20 MB, checking extension and MIME type. Staff, instructors, and org admins can create and publish notes; non-admin authors can edit, unpublish, or soft-delete only their own notes.
- Students have read-only access to published notes through the authenticated inline viewer. Never expose a student download route or direct file URL; watermark each viewer page and document that browser controls are a deterrent, not DRM.
- Keep the live-class integration behind a provider abstraction. The initial Jitsi Meet iframe integration is a basic live-class version, not a claim of full conferencing or DRM security.

## Security and privacy
- Never commit secrets; use environment variables and keep `.env.example` aligned.
- Never log or return passwords, password hashes, tokens, or temporary credentials beyond the one-time development seed output.
- Use secure httpOnly cookies, helmet, CORS, and rate limiting on authentication and submission endpoints.
- Never expose assessment correct answers to clients; grading belongs on the server.
- Enforce staff field-level access on the backend. Do not expose passwords, tokens, or hidden sensitive fields.
- `SUPER_ADMIN` monitors organization summaries and manages organization activation; it cannot access organizations' internal student data without an explicit, recorded audit entry.
- Protected uploads are served only through authenticated routes.

## Checkpoint workflow
- Work in one requested checkpoint at a time: 1A, then 1B, then 1C. Stop after each checkpoint and wait for user confirmation before starting the next.
- Before coding each checkpoint, explain the plan and list the files expected to change; wait for explicit approval when requested.
- Warn the user before any command that deletes or resets database data. Never run such a command without explicit approval.
- After each checkpoint, run the relevant lint, type-check, and tests; fix failures before reporting completion.
- Report changed behavior, exact Windows/PowerShell commands to run, migration and seed instructions, test results, a step-by-step manual test, and assumptions or open questions.
- Make small, meaningful commits with clear messages after each approved checkpoint.

## Scope for the current phases
- 1A: multi-tenant schema/migration, authentication, organization registration, approval flows, seed script, and tests.
- 1B: Create Staff with a one-time temporary password and forced change on first login; tenant-scoped Student Details and Staff Details; and Publish Notes with private storage and a student view-only viewer.
- 1C: Expert Sessions, Assessments, Practice Q/A, and final tests.
- No courses, videos, payments, certificates, or reports in these phases.

# AGENTS.md: Jishnu Learning Labs Platform

## Project overview
Online learning platform (Udemy-style) for Jishnu Learning Labs. Students register with a Student ID and can only log in after an instructor approves them. Platform includes tutorials, library, expert sessions, audio/video upload, practice sessions, assessments, certificates, payments, staff portal, admin dashboard, and reports.

## Tech stack (do not change without asking)
- Frontend: React + Vite + TypeScript + Tailwind CSS + shadcn/ui, React Router, TanStack Query, React Hook Form + Zod
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL with Prisma (always use migrations, never edit the database by hand)
- Cache/queue: Redis + BullMQ
- Storage: S3-compatible (Cloudflare R2 or AWS S3)
- Video: HLS streaming with short-lived signed URLs, FFmpeg for conversion. Keep the design ready for DRM (VdoCipher/Mux)
- Auth: JWT access + refresh tokens in httpOnly cookies, bcrypt for passwords
- Validation: Zod on every request
- Tests: Vitest + Supertest. Lint/format: ESLint + Prettier
- Logging: Pino

## Folder structure
```
/client      React frontend
/server      Express backend
  /prisma    schema and migrations
  /src       routes, controllers, services, middleware, utils
/docs        documentation
AGENTS.md
docker-compose.yml   PostgreSQL + Redis for local development
```

## Roles
- STUDENT, INSTRUCTOR (expert), STAFF, SUPER_ADMIN
- Separate login pages for Student, Instructor and Staff portals
- Students are grouped into batches assigned to instructors
- An instructor sees only students in their own batches and edits only their own content
- Only instructors approve or reject student registrations. Staff cannot approve
- Students stay PENDING and cannot log in until approved
- One active session per student: a new login invalidates the old one

## Coding rules
- Use TypeScript strict mode. No `any` unless unavoidable and commented
- Keep the layering: route -> controller -> service -> database. No business logic in routes
- Validate all input with Zod. Return consistent error responses
- Enforce permissions on the backend for every route (role check plus ownership check). Never rely on the frontend alone
- Use Prisma migrations for every schema change
- Small, focused files and functions. Follow existing naming and style in the codebase
- Do not rewrite or delete working code unless the task requires it
- Add or update tests for every feature

## Security rules (always)
- Never commit secrets. Use `.env`, and keep `.env.example` updated
- Hash passwords with bcrypt. Never log or return passwords, tokens or hashes
- Use helmet, CORS, secure httpOnly cookies and rate limiting on auth and submit endpoints
- Never send correct answers to the client during an assessment. Grade on the server only
- Never store card or UPI details. Store only gateway tokens and transaction IDs. Verify payment webhook signatures
- Protected media is streamed only, with signed expiring URLs. No download endpoints for tutorials or expert sessions
- Staff field-level rules: staff can view Student ID, name, batch and status. Email/phone are masked in exports. Address, date of birth and ID documents are hidden unless the Super Admin grants access
- Write an audit log entry for approvals, role changes, regrades, refunds, exports and sensitive data views

## Content protection note
Browsers cannot fully block screenshots or screen recording. Use the layered approach: streaming only, signed URLs, DRM-ready player, dynamic watermark (student ID + name), tab-focus pause, and event logging. Do not claim it is unbreakable.

## Modules
1. Student Portal
2. Instructor Portal
3. Course Management
4. Learning Dashboard
5. Assessments
6. Certificates
7. Payment Integration
8. Admin Dashboard (includes Staff Portal)
9. Reports & Analytics

## Working process
- Build ONE phase at a time and stop. Wait for confirmation before the next phase
- Before coding, explain the plan and list the files you will create or change
- After coding, run lint, type-check and tests, and fix failures before finishing
- Make small, meaningful commits with clear messages
- At the end of every task, report: what changed, how to run it, test results, and any assumptions or open questions

## Commands (update to match the project)
- Start services: `docker compose up -d`
- Backend dev: `cd server && npm run dev`
- Frontend dev: `cd client && npm run dev`
- Migrate DB: `cd server && npx prisma migrate dev`
- Seed DB: `cd server && npx prisma db seed`
- Tests: `cd server && npm test` and `cd client && npm test`
- Lint: `npm run lint`

## Definition of done
- Feature works end to end for the right roles, and is blocked for the wrong ones
- Tests pass, lint and type-check are clean
- No secrets or debug code committed
- README or docs updated if setup or behavior changed
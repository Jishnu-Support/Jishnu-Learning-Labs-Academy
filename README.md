# Jishnu Learning Labs

Phase 1 and Phase 2 foundation for the Jishnu Learning Labs learning platform. It includes student registration and approval-gated authentication, instructor approval tools, instructor-owned course outlines, seeded local accounts, and basic role portals.

## Requirements

- Node.js 24 and npm
- Local PostgreSQL listening on port 5432
- No Docker or Redis is used in Phase 1

## Create local databases

Using pgAdmin, connect to your local PostgreSQL server and create two databases: `jishnu_learning_labs` and `jishnu_learning_labs_test`. The test database must be separate and disposable. If PostgreSQL is not installed, stop here and request approval before installing system software.

## Configure environment

From PowerShell in this repository, copy the example files if local `.env` files do not already exist:

```powershell
if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
if (-not (Test-Path .\client\.env)) { Copy-Item .\client\.env.example .\client\.env }
```

Edit `server/.env` and replace the PostgreSQL username/password in both connection strings. Set `DATABASE_URL` to `jishnu_learning_labs` and `TEST_DATABASE_URL` to `jishnu_learning_labs_test`. Generate two different random JWT secrets (each at least 32 characters); PowerShell can generate each with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Put the first result in `JWT_ACCESS_SECRET` and the second in `JWT_REFRESH_SECRET`. Keep `.env` files private; never commit them.

## Install, migrate, and seed

```powershell
Set-Location "D:\Learning labs"
npm install
npm run prisma:generate --workspace server
npm run db:migrate --workspace server
npm run db:seed --workspace server
```

The seed command prints development-only login credentials. All seeded accounts use `SEED_PASSWORD` if set before seeding; otherwise the local-only default is `JishnuDevOnly!2026`. Do not use the default outside development.

## Run locally

Open two PowerShell terminals in `D:\Learning labs`.

Terminal 1:

```powershell
npm run dev:server
```

Expected: Pino reports that the API is listening on port 4000.

Terminal 2:

```powershell
npm run dev:client
```

Expected: Vite reports `http://localhost:5173`. The API health check is `http://localhost:4000/api/health`.

## Test and quality checks

Before tests, apply the migration to the dedicated test database. In a PowerShell terminal, temporarily set `DATABASE_URL` for that command:

```powershell
$env:DATABASE_URL = "postgresql://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/jishnu_learning_labs_test?schema=public"
npm run db:migrate --workspace server
Remove-Item Env:DATABASE_URL
```

Then run:

```powershell
npm test
npm run lint
npm run typecheck
```

Expected: Vitest passes the API and UI tests, ESLint reports no errors, and both TypeScript projects type-check. Server tests require `TEST_DATABASE_URL` in `server/.env`; they only create uniquely named fixtures and remove their user records.

## Phase 1 endpoints

- `POST /api/auth/students/register`
- `POST /api/auth/students/login`
- `POST /api/auth/instructors/login`
- `POST /api/auth/staff/login` (also used by Super Admin)
- `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/instructor/registrations/pending`
- `POST /api/instructor/registrations/:studentId/approve`
- `POST /api/instructor/registrations/:studentId/reject`
- `GET /api/students` (instructors see their batches, students see themselves, staff and Super Admin see all)
- `GET|POST /api/instructor/courses`
- `GET|PATCH|DELETE /api/instructor/courses/:courseId`
- `POST /api/instructor/courses/:courseId/publish` and `/unpublish`

Access and refresh JWTs are delivered only in httpOnly cookies. Student accounts remain unable to log in until instructor approval. Course video and document content, quizzes, assignments, assessments, payments, Redis, Docker, and reporting remain outside the completed phases.

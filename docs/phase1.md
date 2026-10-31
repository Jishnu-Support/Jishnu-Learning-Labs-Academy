# Phase 1 implementation notes

Phase 1 provides registration, approval-gated student login, instructor approval, portal authentication, role-aware student listing, and development seed accounts.

## Security boundaries

- Access and refresh JWTs are stored in httpOnly cookies; refresh token values are stored in the database only as SHA-256 hashes.
- Student sign-in checks the profile status before issuing a session. Failed or blocked attempts are recorded in `LoginLog`.
- Each successful student login revokes that student’s prior active sessions in a serializable transaction.
- Approval actions require the instructor role and enforce batch ownership in the service layer. Unassigned pending students can be reviewed by instructors.
- Approval and rejection decisions create `AuditLog` entries in the same transaction as the status change.
- Staff and Super Admin can list all students, but staff responses omit email. Student accounts can only list their own profile.
- Cookie `Secure` is enabled in production and disabled for local HTTP development; use HTTPS in production.

## Database

The first schema migration is `server/prisma/migrations/20261031000000_phase1_init/migration.sql`. Prisma Migrate applies it to the local development database and to the separately configured test database.

## Later phases

Instructor course outlines and ownership are covered in Phase 2. Media storage and streaming, lessons and learning materials, assessments, payments, certificates, reports, Redis, and Docker are reserved for later phases.

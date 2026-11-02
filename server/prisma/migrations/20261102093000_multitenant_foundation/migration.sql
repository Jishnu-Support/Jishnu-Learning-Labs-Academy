CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TYPE "Role" ADD VALUE 'ORG_ADMIN';

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "headName" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "website" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "pendingAdminPasswordHash" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Organization" (
    "id", "name", "code", "headName", "contactNumber", "email",
    "address", "city", "state", "country", "status", "createdAt", "updatedAt"
) VALUES (
    'legacy-organization', 'Legacy Jishnu Learning Labs', 'jll-legacy',
    'Legacy Organization Administrator', '+10000000000', 'legacy@jishnu.local',
    'Legacy address', 'Legacy city', 'Legacy state', 'Legacy country',
    'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

ALTER TABLE "User"
    ADD COLUMN "approvedAt" TIMESTAMP(3),
    ADD COLUMN "approvedById" TEXT,
    ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "rejectionReason" TEXT,
    ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "User" AS u
SET "organizationId" = CASE
    WHEN u."role" = 'SUPER_ADMIN' THEN NULL
    ELSE 'legacy-organization'
END;

UPDATE "User" AS u
SET "status" = CASE
    WHEN u."isActive" = false THEN 'SUSPENDED'::"AccountStatus"
    ELSE COALESCE(
        (SELECT sp."status"::TEXT::"AccountStatus" FROM "StudentProfile" AS sp WHERE sp."userId" = u."id"),
        (SELECT aa."status"::TEXT::"AccountStatus" FROM "AccountApproval" AS aa WHERE aa."userId" = u."id"),
        CASE WHEN u."role" = 'SUPER_ADMIN' THEN 'APPROVED'::"AccountStatus" ELSE 'PENDING'::"AccountStatus" END
    )
END;

ALTER TABLE "StudentProfile" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AccountApproval" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Batch" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "BatchInstructor" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "BatchStudent" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Course" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Session" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "LoginLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;

UPDATE "StudentProfile" AS sp
SET "organizationId" = COALESCE(u."organizationId", 'legacy-organization')
FROM "User" AS u
WHERE sp."userId" = u."id";

UPDATE "AccountApproval" AS aa
SET "organizationId" = COALESCE(u."organizationId", 'legacy-organization')
FROM "User" AS u
WHERE aa."userId" = u."id";

UPDATE "Batch" SET "organizationId" = 'legacy-organization';
UPDATE "BatchInstructor" SET "organizationId" = 'legacy-organization';
UPDATE "BatchStudent" SET "organizationId" = 'legacy-organization';

UPDATE "Course" AS c
SET "organizationId" = COALESCE(u."organizationId", 'legacy-organization')
FROM "User" AS u
WHERE c."instructorId" = u."id";

UPDATE "Session" AS s
SET "organizationId" = u."organizationId"
FROM "User" AS u
WHERE s."userId" = u."id";

UPDATE "LoginLog" AS l
SET "organizationId" = u."organizationId"
FROM "User" AS u
WHERE l."userId" = u."id";

UPDATE "AuditLog" AS a
SET "organizationId" = u."organizationId"
FROM "User" AS u
WHERE a."actorId" = u."id";

CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StaffProfile" ("id", "organizationId", "userId", "staffId", "joiningDate", "createdAt")
SELECT
    'migrated-staff-' || u."id",
    COALESCE(u."organizationId", 'legacy-organization'),
    u."id",
    'LEGACY-' || u."id",
    u."createdAt",
    u."createdAt"
FROM "User" AS u
WHERE u."role" = 'STAFF';

CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "storageKey" TEXT,
    "originalName" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpertSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "batchId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "roomName" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpertSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AccountApproval" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Batch" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "BatchInstructor" DROP CONSTRAINT "BatchInstructor_pkey";
ALTER TABLE "BatchInstructor" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "BatchInstructor" ADD CONSTRAINT "BatchInstructor_pkey" PRIMARY KEY ("organizationId", "batchId", "instructorId");
ALTER TABLE "BatchStudent" DROP CONSTRAINT "BatchStudent_pkey";
ALTER TABLE "BatchStudent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "BatchStudent" ADD CONSTRAINT "BatchStudent_pkey" PRIMARY KEY ("organizationId", "batchId", "studentId");
ALTER TABLE "Course" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StudentProfile" ALTER COLUMN "organizationId" SET NOT NULL;

DROP INDEX "AccountApproval_status_createdAt_idx";
DROP INDEX "AuditLog_targetType_targetId_createdAt_idx";
DROP INDEX "Batch_name_key";
DROP INDEX "BatchInstructor_instructorId_idx";
DROP INDEX "BatchStudent_studentId_idx";
DROP INDEX "Course_instructorId_status_updatedAt_idx";
DROP INDEX "LoginLog_userId_createdAt_idx";
DROP INDEX "Session_userId_revokedAt_expiresAt_idx";
DROP INDEX "StudentProfile_status_createdAt_idx";
DROP INDEX "StudentProfile_studentId_key";
DROP INDEX "User_email_key";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";

CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");
CREATE UNIQUE INDEX "Organization_email_key" ON "Organization"("email");
CREATE INDEX "Organization_status_createdAt_idx" ON "Organization"("status", "createdAt");
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");
CREATE INDEX "StaffProfile_organizationId_joiningDate_idx" ON "StaffProfile"("organizationId", "joiningDate");
CREATE UNIQUE INDEX "StaffProfile_organizationId_staffId_key" ON "StaffProfile"("organizationId", "staffId");
CREATE INDEX "Note_organizationId_published_updatedAt_idx" ON "Note"("organizationId", "published", "updatedAt");
CREATE UNIQUE INDEX "ExpertSession_roomName_key" ON "ExpertSession"("roomName");
CREATE INDEX "ExpertSession_organizationId_startsAt_idx" ON "ExpertSession"("organizationId", "startsAt");
CREATE INDEX "AccountApproval_organizationId_status_createdAt_idx" ON "AccountApproval"("organizationId", "status", "createdAt");
CREATE INDEX "AuditLog_organizationId_targetType_targetId_createdAt_idx" ON "AuditLog"("organizationId", "targetType", "targetId", "createdAt");
CREATE UNIQUE INDEX "Batch_organizationId_name_key" ON "Batch"("organizationId", "name");
CREATE INDEX "BatchInstructor_organizationId_instructorId_idx" ON "BatchInstructor"("organizationId", "instructorId");
CREATE INDEX "BatchStudent_organizationId_studentId_idx" ON "BatchStudent"("organizationId", "studentId");
CREATE INDEX "Course_organizationId_instructorId_status_updatedAt_idx" ON "Course"("organizationId", "instructorId", "status", "updatedAt");
CREATE INDEX "LoginLog_organizationId_userId_createdAt_idx" ON "LoginLog"("organizationId", "userId", "createdAt");
CREATE INDEX "Session_organizationId_userId_revokedAt_expiresAt_idx" ON "Session"("organizationId", "userId", "revokedAt", "expiresAt");
CREATE INDEX "StudentProfile_organizationId_status_createdAt_idx" ON "StudentProfile"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "StudentProfile_organizationId_studentId_key" ON "StudentProfile"("organizationId", "studentId");
CREATE INDEX "User_organizationId_role_status_idx" ON "User"("organizationId", "role", "status");
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountApproval" ADD CONSTRAINT "AccountApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchStudent" ADD CONSTRAINT "BatchStudent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchInstructor" ADD CONSTRAINT "BatchInstructor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpertSession" ADD CONSTRAINT "ExpertSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpertSession" ADD CONSTRAINT "ExpertSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpertSession" ADD CONSTRAINT "ExpertSession_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

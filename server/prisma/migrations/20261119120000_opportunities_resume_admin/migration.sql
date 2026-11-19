ALTER TABLE "TutorProfile"
ADD COLUMN "resumeStorageKey" TEXT,
ADD COLUMN "resumeOriginalName" TEXT;

ALTER TABLE "Course"
ALTER COLUMN "createdById" DROP NOT NULL,
ADD COLUMN "createdBySuperAdminId" TEXT;

ALTER TABLE "Course"
ADD CONSTRAINT "Course_createdBySuperAdminId_fkey"
FOREIGN KEY ("createdBySuperAdminId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaItem"
ALTER COLUMN "uploadedById" DROP NOT NULL,
ADD COLUMN "uploadedBySuperAdminId" TEXT;

ALTER TABLE "MediaItem"
ADD CONSTRAINT "MediaItem_uploadedBySuperAdminId_fkey"
FOREIGN KEY ("uploadedBySuperAdminId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobOpening" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "externalUrl" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closesAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobApplication" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobOpeningId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "resumeStorageKey" TEXT NOT NULL,
  "resumeOriginalName" TEXT NOT NULL,
  "resumeMimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobApplication_organizationId_jobOpeningId_studentId_key"
ON "JobApplication"("organizationId", "jobOpeningId", "studentId");

CREATE INDEX "JobOpening_organizationId_isActive_postedAt_idx"
ON "JobOpening"("organizationId", "isActive", "postedAt");

CREATE INDEX "JobApplication_organizationId_studentId_createdAt_idx"
ON "JobApplication"("organizationId", "studentId", "createdAt");

ALTER TABLE "JobOpening"
ADD CONSTRAINT "JobOpening_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "JobOpening_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobApplication"
ADD CONSTRAINT "JobApplication_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "JobApplication_jobOpeningId_fkey"
FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id")
ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "JobApplication_organizationId_studentId_fkey"
FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

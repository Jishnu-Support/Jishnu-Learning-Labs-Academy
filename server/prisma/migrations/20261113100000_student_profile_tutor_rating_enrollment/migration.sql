-- Add profile metadata and per-course Tutor selection without removing legacy data.
ALTER TABLE "Organization"
ADD COLUMN "ratingRequiresActivity" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "StudentProfile"
ADD COLUMN "educationLevel" TEXT,
ADD COLUMN "educationYear" TEXT,
ADD COLUMN "isDemoIdentityData" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "piiConsentAt" TIMESTAMP(3);

ALTER TABLE "Enrollment"
ADD COLUMN "selectedTutorId" TEXT,
ADD COLUMN "pendingTutorId" TEXT;

UPDATE "Enrollment" AS enrollment
SET "selectedTutorId" = profile."selectedTutorId"
FROM "StudentProfile" AS profile
WHERE profile."organizationId" = enrollment."organizationId"
  AND profile."userId" = enrollment."studentId"
  AND profile."selectedTutorId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "CourseInstructor" AS assignment
    WHERE assignment."organizationId" = enrollment."organizationId"
      AND assignment."courseId" = enrollment."courseId"
      AND assignment."instructorId" = profile."selectedTutorId"
  );

ALTER TABLE "TutorReview"
ADD COLUMN "courseId" TEXT,
ADD COLUMN "hiddenAt" TIMESTAMP(3),
ADD COLUMN "hiddenReason" TEXT;

ALTER TABLE "Certificate"
ADD COLUMN "issuedStudentName" TEXT;

UPDATE "Certificate" AS certificate
SET "issuedStudentName" = student."name"
FROM "User" AS student
WHERE student."organizationId" = certificate."organizationId"
  AND student."id" = certificate."studentId";

DROP INDEX "TutorReview_organizationId_studentId_tutorId_key";

CREATE INDEX "TutorReview_organizationId_courseId_createdAt_idx"
ON "TutorReview"("organizationId", "courseId", "createdAt");

CREATE UNIQUE INDEX "TutorReview_organizationId_studentId_tutorId_courseId_key"
ON "TutorReview"("organizationId", "studentId", "tutorId", "courseId");

ALTER TABLE "TutorReview"
ADD CONSTRAINT "TutorReview_organizationId_courseId_fkey"
FOREIGN KEY ("organizationId", "courseId")
REFERENCES "Course"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Enrollment"
ADD CONSTRAINT "Enrollment_organizationId_selectedTutorId_fkey"
FOREIGN KEY ("organizationId", "selectedTutorId")
REFERENCES "User"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Enrollment"
ADD CONSTRAINT "Enrollment_organizationId_pendingTutorId_fkey"
FOREIGN KEY ("organizationId", "pendingTutorId")
REFERENCES "User"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

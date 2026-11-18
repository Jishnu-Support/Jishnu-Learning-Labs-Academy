-- Add optional registration details without changing existing account records.
ALTER TABLE "StudentProfile"
ADD COLUMN "interestedCourse" TEXT,
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

ALTER TABLE "TutorProfile"
ADD COLUMN "fatherName" TEXT,
ADD COLUMN "motherName" TEXT,
ADD COLUMN "interestedCourse" TEXT,
ADD COLUMN "aadhaarEncrypted" TEXT,
ADD COLUMN "aadhaarLast4" TEXT,
ADD COLUMN "apaarIdEncrypted" TEXT,
ADD COLUMN "apaarIdLast4" TEXT,
ADD COLUMN "piiConsentAt" TIMESTAMP(3),
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

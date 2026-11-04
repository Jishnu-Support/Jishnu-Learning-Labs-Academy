ALTER TABLE "StaffProfile" RENAME TO "TutorProfile";
ALTER TABLE "TutorProfile" RENAME COLUMN "staffId" TO "tutorId";

ALTER TABLE "TutorProfile" RENAME CONSTRAINT "StaffProfile_pkey" TO "TutorProfile_pkey";
ALTER TABLE "TutorProfile" RENAME CONSTRAINT "StaffProfile_organizationId_fkey" TO "TutorProfile_organizationId_fkey";
ALTER TABLE "TutorProfile" RENAME CONSTRAINT "StaffProfile_userId_fkey" TO "TutorProfile_userId_fkey";

ALTER INDEX "StaffProfile_userId_key" RENAME TO "TutorProfile_userId_key";
ALTER INDEX "StaffProfile_organizationId_joiningDate_idx" RENAME TO "TutorProfile_organizationId_joiningDate_idx";
ALTER INDEX "StaffProfile_organizationId_staffId_key" RENAME TO "TutorProfile_organizationId_tutorId_key";

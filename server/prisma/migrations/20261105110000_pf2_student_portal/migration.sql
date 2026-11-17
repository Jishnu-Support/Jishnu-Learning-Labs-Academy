-- CreateEnum
CREATE TYPE "ExpertSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AttendanceMark" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- CreateEnum
CREATE TYPE "LibraryKind" AS ENUM ('BOOK', 'DOCUMENT', 'NOTE', 'LINK');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('STUDENT', 'TUTOR', 'ORG_ADMIN', 'SUPER_ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Assessment" DROP CONSTRAINT "Assessment_course_fkey";

-- DropForeignKey
ALTER TABLE "Assessment" DROP CONSTRAINT "Assessment_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "PracticeQuestion" DROP CONSTRAINT "PracticeQuestion_createdBy_fkey";

-- AlterTable
ALTER TABLE "ExpertSession" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "status" "ExpertSessionStatus" NOT NULL DEFAULT 'SCHEDULED';

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "courseId" TEXT,
    "studentId" TEXT NOT NULL,
    "markedById" TEXT,
    "status" "AttendanceMark" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT,
    "createdById" TEXT NOT NULL,
    "kind" "LibraryKind" NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contentText" TEXT,
    "externalUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedLibraryItem" (
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedLibraryItem_pkey" PRIMARY KEY ("organizationId","itemId","studentId")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "issuedById" TEXT,
    "certificateNo" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRating" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRecord_organizationId_studentId_markedAt_idx" ON "AttendanceRecord"("organizationId", "studentId", "markedAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_organizationId_courseId_markedAt_idx" ON "AttendanceRecord"("organizationId", "courseId", "markedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_organizationId_sessionId_studentId_key" ON "AttendanceRecord"("organizationId", "sessionId", "studentId");

-- CreateIndex
CREATE INDEX "LibraryItem_organizationId_published_category_kind_updatedA_idx" ON "LibraryItem"("organizationId", "published", "category", "kind", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryItem_organizationId_id_key" ON "LibraryItem"("organizationId", "id");

-- CreateIndex
CREATE INDEX "SavedLibraryItem_organizationId_studentId_createdAt_idx" ON "SavedLibraryItem"("organizationId", "studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");

-- CreateIndex
CREATE INDEX "Certificate_organizationId_studentId_issuedAt_idx" ON "Certificate"("organizationId", "studentId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_organizationId_certificateNo_key" ON "Certificate"("organizationId", "certificateNo");

-- CreateIndex
CREATE INDEX "GameRating_organizationId_studentId_updatedAt_idx" ON "GameRating"("organizationId", "studentId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameRating_organizationId_studentId_gameKey_key" ON "GameRating"("organizationId", "studentId", "gameKey");

-- RenameForeignKey
ALTER TABLE "AssessmentQuestion" RENAME CONSTRAINT "AssessmentQuestion_assessment_fkey" TO "AssessmentQuestion_organizationId_assessmentId_fkey";

-- RenameForeignKey
ALTER TABLE "Course" RENAME CONSTRAINT "Course_createdBy_fkey" TO "Course_organizationId_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "CourseInstructor" RENAME CONSTRAINT "CourseInstructor_course_fkey" TO "CourseInstructor_organizationId_courseId_fkey";

-- RenameForeignKey
ALTER TABLE "CourseInstructor" RENAME CONSTRAINT "CourseInstructor_instructor_fkey" TO "CourseInstructor_organizationId_instructorId_fkey";

-- RenameForeignKey
ALTER TABLE "CourseTopic" RENAME CONSTRAINT "CourseTopic_course_fkey" TO "CourseTopic_organizationId_courseId_fkey";

-- RenameForeignKey
ALTER TABLE "Enrollment" RENAME CONSTRAINT "Enrollment_course_fkey" TO "Enrollment_organizationId_courseId_fkey";

-- RenameForeignKey
ALTER TABLE "Enrollment" RENAME CONSTRAINT "Enrollment_student_fkey" TO "Enrollment_organizationId_studentId_fkey";

-- RenameForeignKey
ALTER TABLE "PracticeQuestion" RENAME CONSTRAINT "PracticeQuestion_course_fkey" TO "PracticeQuestion_organizationId_courseId_fkey";

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeQuestion" ADD CONSTRAINT "PracticeQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertSession" ADD CONSTRAINT "ExpertSession_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExpertSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_organizationId_createdById_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLibraryItem" ADD CONSTRAINT "SavedLibraryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLibraryItem" ADD CONSTRAINT "SavedLibraryItem_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "LibraryItem"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLibraryItem" ADD CONSTRAINT "SavedLibraryItem_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRating" ADD CONSTRAINT "GameRating_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRating" ADD CONSTRAINT "GameRating_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AssessmentAttempt_organizationId_assessmentId_status_submittedA" RENAME TO "AssessmentAttempt_organizationId_assessmentId_status_submit_idx";

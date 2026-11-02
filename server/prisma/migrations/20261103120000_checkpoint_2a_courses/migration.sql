ALTER TYPE "CourseStatus" ADD VALUE 'ARCHIVED';

CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'DROPPED');
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "QuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'SHORT_ANSWER', 'MATCH', 'FILL_IN_BLANK');
CREATE TYPE "QuestionDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_id_key" UNIQUE ("organizationId", "id");

ALTER TABLE "Course"
    ADD COLUMN "code" TEXT,
    ADD COLUMN "category" TEXT,
    ADD COLUMN "plannedHours" INTEGER,
    ADD COLUMN "startDate" DATE,
    ADD COLUMN "endDate" DATE,
    ADD COLUMN "minimumAttendancePercent" INTEGER NOT NULL DEFAULT 75,
    ADD COLUMN "requiresAssessmentPass" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "createdById" TEXT;

UPDATE "Course"
SET
    "code" = 'LEGACY-' || "id",
    "category" = 'General',
    "plannedHours" = 1,
    "startDate" = CURRENT_DATE,
    "endDate" = CURRENT_DATE,
    "createdById" = "instructorId";

ALTER TABLE "Course"
    ALTER COLUMN "code" SET NOT NULL,
    ALTER COLUMN "category" SET NOT NULL,
    ALTER COLUMN "plannedHours" SET NOT NULL,
    ALTER COLUMN "startDate" SET NOT NULL,
    ALTER COLUMN "endDate" SET NOT NULL,
    ALTER COLUMN "createdById" SET NOT NULL;

CREATE UNIQUE INDEX "Course_organizationId_code_key" ON "Course"("organizationId", "code");
CREATE UNIQUE INDEX "Course_organizationId_id_key" ON "Course"("organizationId", "id");
CREATE INDEX "Course_organizationId_status_updatedAt_idx" ON "Course"("organizationId", "status", "updatedAt");
CREATE INDEX "Course_organizationId_createdById_status_updatedAt_idx" ON "Course"("organizationId", "createdById", "status", "updatedAt");

CREATE TABLE "CourseInstructor" (
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("organizationId", "courseId", "instructorId")
);

INSERT INTO "CourseInstructor" ("organizationId", "courseId", "instructorId")
SELECT "organizationId", "id", "instructorId" FROM "Course";

CREATE INDEX "CourseInstructor_organizationId_instructorId_courseId_idx"
    ON "CourseInstructor"("organizationId", "instructorId", "courseId");

CREATE TABLE "CourseTopic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plannedHours" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "coveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseTopic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseTopic_organizationId_courseId_order_key"
    ON "CourseTopic"("organizationId", "courseId", "order");
CREATE INDEX "CourseTopic_organizationId_courseId_order_idx"
    ON "CourseTopic"("organizationId", "courseId", "order");

CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Enrollment_organizationId_courseId_studentId_key"
    ON "Enrollment"("organizationId", "courseId", "studentId");
CREATE INDEX "Enrollment_organizationId_studentId_status_enrolledAt_idx"
    ON "Enrollment"("organizationId", "studentId", "status", "enrolledAt");
CREATE INDEX "Enrollment_organizationId_courseId_status_enrolledAt_idx"
    ON "Enrollment"("organizationId", "courseId", "status", "enrolledAt");

CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "passMark" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Assessment_organizationId_id_key" ON "Assessment"("organizationId", "id");
CREATE INDEX "Assessment_organizationId_courseId_status_idx"
    ON "Assessment"("organizationId", "courseId", "status");

CREATE TABLE "AssessmentQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "marks" INTEGER NOT NULL,
    "explanation" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentQuestion_organizationId_assessmentId_order_key"
    ON "AssessmentQuestion"("organizationId", "assessmentId", "order");
CREATE INDEX "AssessmentQuestion_organizationId_assessmentId_idx"
    ON "AssessmentQuestion"("organizationId", "assessmentId");

CREATE TABLE "PracticeQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT,
    "createdById" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "topic" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticeQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PracticeQuestion_organizationId_courseId_type_topic_idx"
    ON "PracticeQuestion"("organizationId", "courseId", "type", "topic");

ALTER TABLE "Note" ADD COLUMN "courseId" TEXT;
CREATE INDEX "Note_organizationId_courseId_idx" ON "Note"("organizationId", "courseId");

ALTER TABLE "Course" DROP CONSTRAINT "Course_instructorId_fkey";
DROP INDEX "Course_organizationId_instructorId_status_updatedAt_idx";
ALTER TABLE "Course" DROP COLUMN "instructorId";

ALTER TABLE "Course" ADD CONSTRAINT "Course_createdBy_fkey"
    FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_course_fkey"
    FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_instructor_fkey"
    FOREIGN KEY ("organizationId", "instructorId") REFERENCES "User"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseTopic" ADD CONSTRAINT "CourseTopic_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseTopic" ADD CONSTRAINT "CourseTopic_course_fkey"
    FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_course_fkey"
    FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_student_fkey"
    FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_course_fkey"
    FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_createdBy_fkey"
    FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_assessment_fkey"
    FOREIGN KEY ("organizationId", "assessmentId") REFERENCES "Assessment"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeQuestion" ADD CONSTRAINT "PracticeQuestion_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeQuestion" ADD CONSTRAINT "PracticeQuestion_course_fkey"
    FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeQuestion" ADD CONSTRAINT "PracticeQuestion_createdBy_fkey"
    FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PracticeQuestion" ADD CONSTRAINT "PracticeQuestion_topicId_fkey"
    FOREIGN KEY ("topicId") REFERENCES "CourseTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

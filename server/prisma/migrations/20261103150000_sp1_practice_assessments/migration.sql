ALTER TYPE "AssessmentStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'FILL_BLANK';

CREATE TYPE "ResultReleaseMode" AS ENUM ('IMMEDIATE', 'MANUAL');
CREATE TYPE "AssessmentAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');
CREATE TYPE "PracticeSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

ALTER TABLE "Assessment"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resultReleaseMode" "ResultReleaseMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "answerReviewAllowed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "weight" DOUBLE PRECISION,
  ADD COLUMN "publishedSnapshot" JSONB,
  ADD COLUMN "resultsReleasedAt" TIMESTAMP(3);

ALTER TABLE "AssessmentQuestion"
  ADD COLUMN "topic" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "topicId" TEXT,
  ADD COLUMN "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'BEGINNER',
  ADD COLUMN "sourceQuestionId" TEXT;

ALTER TABLE "PracticeQuestion"
  ADD COLUMN "marks" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "AssessmentAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" "AssessmentAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "snapshot" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "score" DOUBLE PRECISION,
  "percentage" DOUBLE PRECISION,
  "passed" BOOLEAN,
  "flagged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssessmentAttempt_organizationId_id_key" ON "AssessmentAttempt"("organizationId", "id");
CREATE UNIQUE INDEX "AssessmentAttempt_organizationId_studentId_activeKey_key" ON "AssessmentAttempt"("organizationId", "studentId", "activeKey");
CREATE INDEX "AssessmentAttempt_organizationId_studentId_status_startedAt_idx" ON "AssessmentAttempt"("organizationId", "studentId", "status", "startedAt");
CREATE INDEX "AssessmentAttempt_organizationId_assessmentId_status_submittedAt_idx" ON "AssessmentAttempt"("organizationId", "assessmentId", "status", "submittedAt");

CREATE TABLE "AssessmentAttemptAnswer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" JSONB NOT NULL,
  "score" DOUBLE PRECISION,
  "answeredAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssessmentAttemptAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssessmentAttemptAnswer_organizationId_attemptId_questionId_key" ON "AssessmentAttemptAnswer"("organizationId", "attemptId", "questionId");
CREATE INDEX "AssessmentAttemptAnswer_organizationId_attemptId_idx" ON "AssessmentAttemptAnswer"("organizationId", "attemptId");

CREATE TABLE "AssessmentAttemptEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentAttemptEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssessmentAttemptEvent_organizationId_attemptId_createdAt_idx" ON "AssessmentAttemptEvent"("organizationId", "attemptId", "createdAt");

CREATE TABLE "PracticeSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "questionIds" JSONB NOT NULL,
  "totalQuestions" INTEGER NOT NULL,
  "answeredCount" INTEGER NOT NULL DEFAULT 0,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "timeLimitSeconds" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "status" "PracticeSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PracticeSession_organizationId_id_key" ON "PracticeSession"("organizationId", "id");
CREATE INDEX "PracticeSession_organizationId_studentId_createdAt_idx" ON "PracticeSession"("organizationId", "studentId", "createdAt");

CREATE TABLE "PracticeSessionAnswer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" JSONB NOT NULL,
  "isCorrect" BOOLEAN NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeSessionAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PracticeSessionAnswer_organizationId_sessionId_questionId_key" ON "PracticeSessionAnswer"("organizationId", "sessionId", "questionId");
CREATE INDEX "PracticeSessionAnswer_organizationId_sessionId_idx" ON "PracticeSessionAnswer"("organizationId", "sessionId");

ALTER TABLE "AssessmentAttempt"
  ADD CONSTRAINT "AssessmentAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssessmentAttempt_organizationId_assessmentId_fkey" FOREIGN KEY ("organizationId", "assessmentId") REFERENCES "Assessment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssessmentAttempt_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttemptAnswer"
  ADD CONSTRAINT "AssessmentAttemptAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssessmentAttemptAnswer_organizationId_attemptId_fkey" FOREIGN KEY ("organizationId", "attemptId") REFERENCES "AssessmentAttempt"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttemptEvent"
  ADD CONSTRAINT "AssessmentAttemptEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssessmentAttemptEvent_organizationId_attemptId_fkey" FOREIGN KEY ("organizationId", "attemptId") REFERENCES "AssessmentAttempt"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSession"
  ADD CONSTRAINT "PracticeSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PracticeSession_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PracticeSession_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSessionAnswer"
  ADD CONSTRAINT "PracticeSessionAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PracticeSessionAnswer_organizationId_sessionId_fkey" FOREIGN KEY ("organizationId", "sessionId") REFERENCES "PracticeSession"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

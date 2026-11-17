CREATE TABLE "PracticeSet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "difficulty" "QuestionDifficulty" NOT NULL,
  "questionIds" JSONB NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeSet_organizationId_id_key"
  ON "PracticeSet"("organizationId", "id");
CREATE INDEX "PracticeSet_organizationId_courseId_published_updatedAt_idx"
  ON "PracticeSet"("organizationId", "courseId", "published", "updatedAt");

ALTER TABLE "PracticeSet"
  ADD CONSTRAINT "PracticeSet_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSet"
  ADD CONSTRAINT "PracticeSet_organizationId_courseId_fkey"
  FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSet"
  ADD CONSTRAINT "PracticeSet_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PracticeSession"
  ADD COLUMN "practiceSetId" TEXT;
ALTER TABLE "PracticeSession"
  ADD CONSTRAINT "PracticeSession_organizationId_practiceSetId_fkey"
  FOREIGN KEY ("organizationId", "practiceSetId") REFERENCES "PracticeSet"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

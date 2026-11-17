-- AlterTable
ALTER TABLE "Course" ADD COLUMN "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile"
ADD COLUMN "aadhaarEncrypted" TEXT,
ADD COLUMN "aadhaarLast4" TEXT,
ADD COLUMN "apaarIdEncrypted" TEXT,
ADD COLUMN "apaarIdLast4" TEXT,
ADD COLUMN "currentCourse" TEXT,
ADD COLUMN "currentEducation" TEXT,
ADD COLUMN "fatherName" TEXT,
ADD COLUMN "institutionName" TEXT,
ADD COLUMN "motherName" TEXT,
ADD COLUMN "profilePhotoStorageKey" TEXT,
ADD COLUMN "selectedTutorId" TEXT;

-- CreateTable
CREATE TABLE "TutorReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TutorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedNote" (
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedNote_pkey" PRIMARY KEY ("organizationId", "noteId", "studentId")
);

-- CreateIndex
CREATE INDEX "TutorReview_organizationId_tutorId_createdAt_idx" ON "TutorReview"("organizationId", "tutorId", "createdAt");
CREATE UNIQUE INDEX "TutorReview_organizationId_studentId_tutorId_key" ON "TutorReview"("organizationId", "studentId", "tutorId");
CREATE INDEX "SavedNote_organizationId_studentId_createdAt_idx" ON "SavedNote"("organizationId", "studentId", "createdAt");
CREATE UNIQUE INDEX "Note_organizationId_id_key" ON "Note"("organizationId", "id");
CREATE INDEX "StudentProfile_organizationId_selectedTutorId_idx" ON "StudentProfile"("organizationId", "selectedTutorId");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_organizationId_selectedTutorId_fkey" FOREIGN KEY ("organizationId", "selectedTutorId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TutorReview" ADD CONSTRAINT "TutorReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TutorReview" ADD CONSTRAINT "TutorReview_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TutorReview" ADD CONSTRAINT "TutorReview_organizationId_tutorId_fkey" FOREIGN KEY ("organizationId", "tutorId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedNote" ADD CONSTRAINT "SavedNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedNote" ADD CONSTRAINT "SavedNote_organizationId_noteId_fkey" FOREIGN KEY ("organizationId", "noteId") REFERENCES "Note"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedNote" ADD CONSTRAINT "SavedNote_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

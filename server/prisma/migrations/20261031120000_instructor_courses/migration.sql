CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "instructorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Course_instructorId_status_updatedAt_idx" ON "Course"("instructorId", "status", "updatedAt");
ALTER TABLE "Course" ADD CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

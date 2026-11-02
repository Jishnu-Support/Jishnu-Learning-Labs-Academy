CREATE TYPE "MediaType" AS ENUM ('VIDEO', 'AUDIO');
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "MediaVisibility" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "MediaJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE UNIQUE INDEX "CourseTopic_organizationId_id_key"
ON "CourseTopic" ("organizationId", "id");

CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "MediaType" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'DRAFT',
    "durationSeconds" INTEGER,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "originalKey" TEXT,
    "streamKey" TEXT,
    "thumbnailKey" TEXT,
    "uploadedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WatchProgress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "lastPositionSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaItem_organizationId_id_key"
ON "MediaItem" ("organizationId", "id");
CREATE INDEX "MediaItem_organizationId_deletedAt_status_createdAt_idx"
ON "MediaItem" ("organizationId", "deletedAt", "status", "createdAt");
CREATE INDEX "MediaItem_organizationId_courseId_type_status_idx"
ON "MediaItem" ("organizationId", "courseId", "type", "status");
CREATE INDEX "MediaItem_organizationId_uploadedById_createdAt_idx"
ON "MediaItem" ("organizationId", "uploadedById", "createdAt");

CREATE UNIQUE INDEX "MediaJob_organizationId_mediaId_key"
ON "MediaJob" ("organizationId", "mediaId");
CREATE INDEX "MediaJob_status_availableAt_createdAt_idx"
ON "MediaJob" ("status", "availableAt", "createdAt");
CREATE INDEX "MediaJob_organizationId_status_availableAt_idx"
ON "MediaJob" ("organizationId", "status", "availableAt");

CREATE UNIQUE INDEX "WatchProgress_organizationId_studentId_mediaId_key"
ON "WatchProgress" ("organizationId", "studentId", "mediaId");
CREATE INDEX "WatchProgress_organizationId_mediaId_completed_idx"
ON "WatchProgress" ("organizationId", "mediaId", "completed");

ALTER TABLE "MediaItem"
ADD CONSTRAINT "MediaItem_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaItem"
ADD CONSTRAINT "MediaItem_organizationId_courseId_fkey"
FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaItem"
ADD CONSTRAINT "MediaItem_organizationId_topicId_fkey"
FOREIGN KEY ("organizationId", "topicId") REFERENCES "CourseTopic"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaItem"
ADD CONSTRAINT "MediaItem_organizationId_uploadedById_fkey"
FOREIGN KEY ("organizationId", "uploadedById") REFERENCES "User"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaJob"
ADD CONSTRAINT "MediaJob_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaJob"
ADD CONSTRAINT "MediaJob_organizationId_mediaId_fkey"
FOREIGN KEY ("organizationId", "mediaId") REFERENCES "MediaItem"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchProgress"
ADD CONSTRAINT "WatchProgress_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchProgress"
ADD CONSTRAINT "WatchProgress_organizationId_studentId_fkey"
FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchProgress"
ADD CONSTRAINT "WatchProgress_organizationId_mediaId_fkey"
FOREIGN KEY ("organizationId", "mediaId") REFERENCES "MediaItem"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

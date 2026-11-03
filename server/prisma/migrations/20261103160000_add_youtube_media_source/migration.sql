CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'YOUTUBE');

ALTER TABLE "MediaItem"
  ADD COLUMN "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "youtubeVideoId" VARCHAR(11);

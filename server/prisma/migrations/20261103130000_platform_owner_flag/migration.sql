ALTER TABLE "Organization"
ADD COLUMN "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Organization_single_platform_owner"
ON "Organization" ("isPlatformOwner")
WHERE "isPlatformOwner" = true;

ALTER TABLE "TutorProfile"
ADD COLUMN "acceptsNewFees" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TutorCoursePlanHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "changedById" TEXT,
    "previousPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorCoursePlanHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TutorCoursePlanHistory_organizationId_planId_createdAt_idx"
ON "TutorCoursePlanHistory"("organizationId", "planId", "createdAt");

ALTER TABLE "TutorCoursePlanHistory"
ADD CONSTRAINT "TutorCoursePlanHistory_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TutorCoursePlanHistory"
ADD CONSTRAINT "TutorCoursePlanHistory_organizationId_planId_fkey"
FOREIGN KEY ("organizationId", "planId") REFERENCES "TutorCoursePlan"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TutorCoursePlanHistory"
ADD CONSTRAINT "TutorCoursePlanHistory_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

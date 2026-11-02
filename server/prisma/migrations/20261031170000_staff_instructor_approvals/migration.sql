CREATE TABLE "AccountApproval" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "StudentStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountApproval_userId_key" ON "AccountApproval"("userId");
CREATE INDEX "AccountApproval_status_createdAt_idx" ON "AccountApproval"("status", "createdAt");

ALTER TABLE "AccountApproval" ADD CONSTRAINT "AccountApproval_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountApproval" ADD CONSTRAINT "AccountApproval_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "Role" RENAME VALUE 'STAFF' TO 'TUTOR';

ALTER TABLE "StaffProfile"
ADD COLUMN "bio" TEXT,
ADD COLUMN "expertise" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "photoStorageKey" TEXT;

CREATE TYPE "NotificationType" AS ENUM (
  'CONTENT_PUBLISHED',
  'SESSION_SCHEDULED',
  'SESSION_REMINDER',
  'ASSESSMENT_PUBLISHED',
  'ASSESSMENT_CLOSING',
  'ASSESSMENT_RESULTS',
  'ACCOUNT_PENDING',
  'ACCOUNT_STATUS',
  'REQUEST_STATUS',
  'PAYMENT_STATUS',
  'SUBSCRIPTION_STATUS',
  'CERTIFICATE_ISSUED',
  'ATTENDANCE_ALERT',
  'CLASS_BOOKED',
  'PAYOUT_RECORDED',
  'SYSTEM'
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "courseId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "groupKey" TEXT,
  "groupCount" INTEGER NOT NULL DEFAULT 1,
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Notification_organizationId_userId_dedupeKey_key"
ON "Notification"("organizationId", "userId", "dedupeKey");
CREATE INDEX "Notification_organizationId_userId_createdAt_idx"
ON "Notification"("organizationId", "userId", "createdAt");
CREATE INDEX "Notification_organizationId_userId_readAt_createdAt_idx"
ON "Notification"("organizationId", "userId", "readAt", "createdAt");
CREATE INDEX "Notification_organizationId_userId_groupKey_createdAt_idx"
ON "Notification"("organizationId", "userId", "groupKey", "createdAt");
CREATE INDEX "Notification_organizationId_courseId_createdAt_idx"
ON "Notification"("organizationId", "courseId", "createdAt");

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_category_key"
ON "NotificationPreference"("organizationId", "userId", "category");
CREATE INDEX "NotificationPreference_organizationId_userId_idx"
ON "NotificationPreference"("organizationId", "userId");

CREATE TABLE "NotificationSchedulerLock" (
  "name" TEXT NOT NULL,
  "lockedUntil" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationSchedulerLock_pkey" PRIMARY KEY ("name")
);

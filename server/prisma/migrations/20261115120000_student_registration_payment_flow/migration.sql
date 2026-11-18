ALTER TYPE "AccountStatus" ADD VALUE 'PENDING_PAYMENT';

CREATE TYPE "RegistrationPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED');

ALTER TABLE "Course"
ADD COLUMN "registrationMonthlyFee" DECIMAL(12, 2);

CREATE TABLE "RegistrationPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "RegistrationPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "statusTokenHash" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationPayment_statusTokenHash_key"
ON "RegistrationPayment"("statusTokenHash");

CREATE UNIQUE INDEX "RegistrationPayment_organizationId_studentId_key"
ON "RegistrationPayment"("organizationId", "studentId");

CREATE INDEX "RegistrationPayment_organizationId_status_createdAt_idx"
ON "RegistrationPayment"("organizationId", "status", "createdAt");

ALTER TABLE "RegistrationPayment"
ADD CONSTRAINT "RegistrationPayment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationPayment"
ADD CONSTRAINT "RegistrationPayment_organizationId_studentId_fkey"
FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationPayment"
ADD CONSTRAINT "RegistrationPayment_organizationId_courseId_fkey"
FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "SubscriptionPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('MOCK', 'RAZORPAY');

-- AlterTable
ALTER TABLE "ExpertSession" ADD COLUMN     "freePreview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LibraryItem" ADD COLUMN     "freePreview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "freePreview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "freePreview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "invoiceAddress" TEXT,
ADD COLUMN     "invoiceName" TEXT,
ADD COLUMN     "invoiceTaxId" TEXT,
ADD COLUMN     "maximumMonthlyFee" DECIMAL(12,2),
ADD COLUMN     "maximumQuarterlyFee" DECIMAL(12,2),
ADD COLUMN     "maximumYearlyFee" DECIMAL(12,2),
ADD COLUMN     "minimumMonthlyFee" DECIMAL(12,2),
ADD COLUMN     "minimumQuarterlyFee" DECIMAL(12,2),
ADD COLUMN     "minimumYearlyFee" DECIMAL(12,2),
ADD COLUMN     "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TutorCoursePlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "period" "SubscriptionPeriod" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorCoursePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "periodsPaid" INTEGER NOT NULL DEFAULT 1,
    "deactivatedBy" TEXT,
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" "PaymentProviderKind" NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodsCount" INTEGER NOT NULL DEFAULT 1,
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TutorCoursePlan_organizationId_courseId_isActive_idx" ON "TutorCoursePlan"("organizationId", "courseId", "isActive");

-- CreateIndex
CREATE INDEX "TutorCoursePlan_organizationId_tutorId_isActive_idx" ON "TutorCoursePlan"("organizationId", "tutorId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TutorCoursePlan_organizationId_id_key" ON "TutorCoursePlan"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TutorCoursePlan_organizationId_tutorId_courseId_period_key" ON "TutorCoursePlan"("organizationId", "tutorId", "courseId", "period");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_studentId_status_endsAt_idx" ON "Subscription"("organizationId", "studentId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_courseId_status_endsAt_idx" ON "Subscription"("organizationId", "courseId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_tutorId_status_idx" ON "Subscription"("organizationId", "tutorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_id_key" ON "Subscription"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_studentId_tutorId_courseId_key" ON "Subscription"("organizationId", "studentId", "tutorId", "courseId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_studentId_createdAt_idx" ON "Payment"("organizationId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_tutorId_status_createdAt_idx" ON "Payment"("organizationId", "tutorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_courseId_status_idx" ON "Payment"("organizationId", "courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_id_key" ON "Payment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_receiptNumber_key" ON "Payment"("organizationId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "TutorCoursePlan" ADD CONSTRAINT "TutorCoursePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorCoursePlan" ADD CONSTRAINT "TutorCoursePlan_organizationId_tutorId_fkey" FOREIGN KEY ("organizationId", "tutorId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorCoursePlan" ADD CONSTRAINT "TutorCoursePlan_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_tutorId_fkey" FOREIGN KEY ("organizationId", "tutorId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "TutorCoursePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_studentId_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_tutorId_fkey" FOREIGN KEY ("organizationId", "tutorId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_courseId_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "TutorCoursePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_subscriptionId_fkey" FOREIGN KEY ("organizationId", "subscriptionId") REFERENCES "Subscription"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

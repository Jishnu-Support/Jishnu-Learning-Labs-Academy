CREATE TYPE "RegistrationPaymentMethod" AS ENUM ('UPI', 'CREDIT_CARD', 'DEBIT_CARD', 'NET_BANKING');

ALTER TABLE "RegistrationPayment"
  ADD COLUMN "applicantRole" "Role" NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "paymentMethod" "RegistrationPaymentMethod",
  ADD COLUMN "transactionReference" VARCHAR(120),
  ADD COLUMN "receiptStorageKey" TEXT,
  ADD COLUMN "receiptOriginalName" TEXT,
  ADD COLUMN "reportedPaid" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "RegistrationPayment_organizationId_applicantRole_status_createdAt_idx"
  ON "RegistrationPayment"("organizationId", "applicantRole", "status", "createdAt");

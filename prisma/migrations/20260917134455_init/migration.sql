-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('patient', 'caregiver', 'admin');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('processing', 'awaiting_confirmation', 'active', 'completed', 'archived', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'patient',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifyCode" TEXT,
    "verifyExpires" TIMESTAMP(3),
    "photoUrl" TEXT,
    "reminderTimes" JSONB NOT NULL DEFAULT '{"morning":"08:00","afternoon":"13:00","night":"21:00"}',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{"push":true,"sms":false,"whatsapp":false}',
    "escalation" JSONB NOT NULL DEFAULT '{"secondReminderMinutes":30,"caregiverAlertMinutes":60}',
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'processing',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doctorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "strength" TEXT NOT NULL DEFAULT '',
    "dosePattern" TEXT NOT NULL DEFAULT '0-0-0',
    "timing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "foodInstruction" TEXT NOT NULL DEFAULT 'any time',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "quantityUnit" TEXT NOT NULL DEFAULT 'tablet',
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "specialNotes" TEXT,
    "indication" TEXT,
    "confidence" JSONB NOT NULL DEFAULT '{}',
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Prescription_userId_idx" ON "Prescription"("userId");

-- CreateIndex
CREATE INDEX "Medicine_prescriptionId_idx" ON "Medicine"("prescriptionId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

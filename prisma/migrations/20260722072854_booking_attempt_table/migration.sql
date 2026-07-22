/*
  Warnings:

  - You are about to drop the column `idempotencyKey` on the `Booking` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Booking_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "idempotencyKey";

-- CreateTable
CREATE TABLE "BookingAttempt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingAttempt_idempotencyKey_key" ON "BookingAttempt"("idempotencyKey");

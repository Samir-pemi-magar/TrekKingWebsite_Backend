-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledDeletionAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_scheduledDeletionAt_idx" ON "User"("scheduledDeletionAt");

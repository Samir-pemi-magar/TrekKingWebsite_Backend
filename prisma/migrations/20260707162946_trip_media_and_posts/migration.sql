/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `Trip` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('FIXED_DEPARTURE', 'AVAILABLE');

-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "imageUrl",
ADD COLUMN     "coverImagePublicId" TEXT,
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "type" "TripType" NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE "TripDeparture" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripDeparture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPhoto" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripVideo" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostPhoto" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostVideo" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "thumbnailUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostVideo_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TripDeparture" ADD CONSTRAINT "TripDeparture_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPhoto" ADD CONSTRAINT "TripPhoto_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripVideo" ADD CONSTRAINT "TripVideo_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPhoto" ADD CONSTRAINT "PostPhoto_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostVideo" ADD CONSTRAINT "PostVideo_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

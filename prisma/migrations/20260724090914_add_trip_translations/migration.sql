-- CreateEnum
CREATE TYPE "TranslationSource" AS ENUM ('MACHINE', 'REVIEWED');

-- CreateTable
CREATE TABLE "TripTranslation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bestSeason" TEXT,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "TranslationSource" NOT NULL DEFAULT 'MACHINE',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryDayTranslation" (
    "id" TEXT NOT NULL,
    "itineraryDayId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "meals" TEXT,
    "accommodation" TEXT,
    "source" "TranslationSource" NOT NULL DEFAULT 'MACHINE',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryDayTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripTranslation_tripId_idx" ON "TripTranslation"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripTranslation_tripId_locale_key" ON "TripTranslation"("tripId", "locale");

-- CreateIndex
CREATE INDEX "ItineraryDayTranslation_itineraryDayId_idx" ON "ItineraryDayTranslation"("itineraryDayId");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryDayTranslation_itineraryDayId_locale_key" ON "ItineraryDayTranslation"("itineraryDayId", "locale");

-- AddForeignKey
ALTER TABLE "TripTranslation" ADD CONSTRAINT "TripTranslation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryDayTranslation" ADD CONSTRAINT "ItineraryDayTranslation_itineraryDayId_fkey" FOREIGN KEY ("itineraryDayId") REFERENCES "ItineraryDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

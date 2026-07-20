-- CreateTable
CREATE TABLE "SiteContent" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "homeHeroImageUrl" TEXT,
    "homeHeroPublicId" TEXT,
    "aboutHeroImageUrl" TEXT,
    "aboutHeroPublicId" TEXT,
    "aboutIntro" TEXT,
    "aboutBody" TEXT,
    "aboutFeatures" JSONB,
    "aboutClosing" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "excludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "includes" TEXT[] DEFAULT ARRAY[]::TEXT[];

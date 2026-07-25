/*
  Warnings:

  - Changed the type of `region` on the `Trip` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "region",
ADD COLUMN     "region" TEXT NOT NULL;

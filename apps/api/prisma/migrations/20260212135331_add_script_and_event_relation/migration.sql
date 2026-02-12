-- DropIndex
DROP INDEX "Script_authorUserId_idx";

-- DropIndex
DROP INDEX "Script_createdAt_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

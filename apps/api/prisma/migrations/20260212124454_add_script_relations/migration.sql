-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC',
ALTER COLUMN "guidanceMode" SET DEFAULT 'AI',
ALTER COLUMN "timezone" SET DEFAULT 'Europe/London';

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intention" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Script_authorUserId_idx" ON "Script"("authorUserId");

-- CreateIndex
CREATE INDEX "Script_createdAt_idx" ON "Script"("createdAt");

-- CreateIndex
CREATE INDEX "Event_hostUserId_idx" ON "Event"("hostUserId");

-- CreateIndex
CREATE INDEX "Event_themeId_idx" ON "Event"("themeId");

-- CreateIndex
CREATE INDEX "Event_scriptId_idx" ON "Event"("scriptId");

-- CreateIndex
CREATE INDEX "Event_startTimeUtc_idx" ON "Event"("startTimeUtc");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

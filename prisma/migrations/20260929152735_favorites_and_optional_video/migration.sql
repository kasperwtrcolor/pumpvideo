-- AlterTable
ALTER TABLE "Clip" ALTER COLUMN "videoUrl" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ClipFavorite" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipFavorite_traderId_createdAt_idx" ON "ClipFavorite"("traderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipFavorite_clipId_traderId_key" ON "ClipFavorite"("clipId", "traderId");

-- AddForeignKey
ALTER TABLE "ClipFavorite" ADD CONSTRAINT "ClipFavorite_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavorite" ADD CONSTRAINT "ClipFavorite_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Real engagement, uploads, and creator fees.
--
-- Schema: user-uploaded clips bound to a token (creatorWallet + uploadedById),
-- real likes/comments/shares, and the removal of the simulated trading columns.

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "creatorWallet" TEXT,
ADD COLUMN     "uploadedById" TEXT;

-- AlterTable
ALTER TABLE "Trade" ALTER COLUMN "mode" SET DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "Trader" DROP COLUMN "practiceBalance",
DROP COLUMN "practiceStartBal";

-- CreateTable
CREATE TABLE "ClipLike" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipComment" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipShare" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "traderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipLike_clipId_idx" ON "ClipLike"("clipId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipLike_clipId_traderId_key" ON "ClipLike"("clipId", "traderId");

-- CreateIndex
CREATE INDEX "ClipComment_clipId_createdAt_idx" ON "ClipComment"("clipId", "createdAt");

-- CreateIndex
CREATE INDEX "ClipShare_clipId_idx" ON "ClipShare"("clipId");

-- CreateIndex
CREATE INDEX "Clip_ready_rank_idx" ON "Clip"("ready", "rank");

-- CreateIndex
CREATE INDEX "Trade_coinMint_createdAt_idx" ON "Trade"("coinMint", "createdAt");

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Trader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipLike" ADD CONSTRAINT "ClipLike_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipLike" ADD CONSTRAINT "ClipLike_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipComment" ADD CONSTRAINT "ClipComment_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipComment" ADD CONSTRAINT "ClipComment_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipShare" ADD CONSTRAINT "ClipShare_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipShare" ADD CONSTRAINT "ClipShare_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data cleanup: remove everything the app previously made up.
--
-- These rows are not history, they are simulation artefacts. Leaving them would
-- mean the portfolio claimed holdings the wallet has never owned, the fill log
-- showed trades that never settled, and the feed showed engagement nobody
-- performed. Removing them is the point of this migration, not a side effect.
-- ---------------------------------------------------------------------------

-- Fills that were priced off the curve in our own database and never sent to
-- Solana. No signature, no counterparty, no transfer.
DELETE FROM "Trade" WHERE "mode" = 'PRACTICE';

-- Position rows were only ever written by the practice engine, so every row here
-- is a simulated holding. Live fills populate this table going forward.
DELETE FROM "Position";

-- Engagement counts derived from market cap at ingest time.
UPDATE "Clip" SET "likes" = 0, "shares" = 0, "comments" = 0, "views" = 0;

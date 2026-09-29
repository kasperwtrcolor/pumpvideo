-- Hot-feed ranking: 5-minute price change and volatility on Coin.
--
-- Both columns are additive with defaults, so this is safe to apply to a live
-- table: existing rows get 0 (i.e. "no measured movement yet") and the keeper
-- fills them on its next tick.

-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "change5mPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "volatility5m" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Coin_volatility5m_idx" ON "Coin"("volatility5m");

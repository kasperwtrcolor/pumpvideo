-- Trending board membership: the current Dexscreener-trending set.
--
-- Stamped by the trending ingest for every token on the latest board and
-- cleared for any coin that drops off it. The Trending rail filters on this
-- column rather than on volume, so a token that leaves the board leaves the
-- rail even if its last-measured volume was large.
ALTER TABLE "Coin" ADD COLUMN "trendingAt" TIMESTAMP(3);

-- The rail reads `trendingAt >= now() - window` on every request.
CREATE INDEX "Coin_trendingAt_idx" ON "Coin"("trendingAt");

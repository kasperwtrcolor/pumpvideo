-- Coin activity: 24h transaction count (Hot rail ranking) and a holders
-- refresh cursor.
--
-- `txns24h` is DOUBLE PRECISION rather than INTEGER to match the other
-- Dexscreener-derived floats on Coin (volume24hSol, marketCapSol) and to hold
-- the aggregate without a cast; the value is always a whole number.
--
-- Adding a NOT NULL column WITH a default is an instant, metadata-only change
-- on Postgres 11+ (no table rewrite), so this is safe to run against the live
-- table.
ALTER TABLE "Coin" ADD COLUMN "txns24h" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Coin" ADD COLUMN "holdersSyncedAt" TIMESTAMP(3);

-- Dead-token retention: a soft hide for coins that stopped trading.
--
-- WHY A COLUMN AND NOTHING ELSE CHANGES
--
-- The catalogue grows ~1,500 coins/day, and ~98% of them go to zero volume
-- within days. Left alone they stay in the feed forever, so the feed fills with
-- tokens nobody can trade. This column is how a token is taken out of every
-- feed, list and count *without destroying anything*.
--
-- A soft hide rather than a DELETE because deleting a Coin cascades: Clip,
-- Position, TokenFollow and PricePoint all reference it with onDelete: Cascade.
-- A hard delete therefore silently destroys a user's uploaded clip (and its
-- likes, comments and favorites) and their open position row — and their row in
-- the book is where realized PnL lives. The sweep in lib/retention.ts refuses to
-- hide a coin that any of those depend on, so a user's own content can never be
-- the thing that disappears.
--
-- WHY NOT REUSE "isBanned"
--
-- "isBanned" mirrors pump.fun's own moderation flag and is rewritten from the
-- upstream payload on every ingest and keeper tick (lib/ingest.ts,
-- lib/keeper.ts, app/api/clips/route.ts). Storing retention state there would
-- mean the next sync silently un-hides everything the sweep just hid — a bug
-- that presents as "hiding doesn't work" rather than "something overwrote it".
-- Two different facts, two different columns.
--
-- Additive and nullable: every existing row is NULL, i.e. visible. That is the
-- correct default — nothing becomes invisible just because this shipped.

ALTER TABLE "Coin" ADD COLUMN "hiddenAt" TIMESTAMP(3);

CREATE INDEX "Coin_hiddenAt_idx" ON "Coin"("hiddenAt");

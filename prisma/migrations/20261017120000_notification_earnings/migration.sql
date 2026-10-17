-- Creator payout receipts.
--
-- A buy made through a clip routes 1% of the swap straight to that clip's
-- creator, on-chain, inside the buyer's own transaction. By the time
-- /api/trade/live/confirm records the fill the creator has already been paid,
-- so this column is not a balance being tracked — it is the amount to put on
-- the receipt: the inbox row that says "you earned", and the payout pop that
-- counts up to it.
--
-- Nullable and additive. Every existing notification type (FOLLOW, UPLOAD,
-- TOKEN_CLIP) leaves it null, so no existing read path changes; only the new
-- EARN rows ever write it.

ALTER TABLE "Notification" ADD COLUMN "amountSol" DOUBLE PRECISION;

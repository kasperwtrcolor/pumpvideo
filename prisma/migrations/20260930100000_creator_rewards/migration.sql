-- Creator rewards.
--
-- The in-app buy fee is 1% to the clip's creator + 2% to the treasury, paid
-- on-chain as two SystemProgram transfers appended to the swap. `feeSol` holds
-- the combined amount; these two columns record the creator leg and its
-- recipient, so a creator's lifetime rewards can be summed with one indexed
-- read instead of re-deriving the clip's creator (which the trade row does not
-- carry, and which vanishes if the clip is deleted).
--
-- Existing rows default to 0: historical fees were paid on-chain exactly the
-- same way, but the creator leg was never split out at the time, so it cannot
-- be reconstructed from the stored total (which is 3% whether or not a creator
-- was involved). Rewards therefore count forward from this migration.

ALTER TABLE "Trade" ADD COLUMN "creatorFeeSol" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN "creatorWallet" TEXT;

CREATE INDEX "Trade_creatorWallet_createdAt_idx" ON "Trade"("creatorWallet", "createdAt");

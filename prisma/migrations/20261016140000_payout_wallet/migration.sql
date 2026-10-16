-- Payout wallet.
--
-- Until now a trader had exactly one wallet (the Privy embedded one), so a clip
-- could freeze `creatorWallet` at upload and be right forever. Connect-wallet
-- breaks that assumption: a trader can connect a different wallet any time, and a
-- clip still pointing at the old address would pay a wallet they may no longer
-- control. `payoutWallet` is the trader's stated payout address, proven by a
-- signature, that uploads copy and that updating re-points existing clips to.
--
-- Nullable with no backfill: null means "use walletAddress", which is exactly the
-- behaviour every existing row already has.

ALTER TABLE "Trader" ADD COLUMN "payoutWallet" TEXT;

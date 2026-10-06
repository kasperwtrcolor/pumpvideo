-- The pair a coin is quoted against, when it is not SOL.
--
-- StonkFun launches every coin against something else — a tokenized equity
-- (NVDAX, TSLAX, MCDX) or another token — which is the launchpad's premise and
-- is invisible to the SOL-denominated rails. The label shows the counterparty's
-- mark, so the logo is stored alongside the symbol and the resolved name.
--
-- Null for pump.fun and Dexscreener coins: those are all paired with SOL.
ALTER TABLE "Coin" ADD COLUMN "quoteMint" TEXT;
ALTER TABLE "Coin" ADD COLUMN "quoteSymbol" TEXT;
ALTER TABLE "Coin" ADD COLUMN "quoteName" TEXT;
ALTER TABLE "Coin" ADD COLUMN "quoteIconUrl" TEXT;

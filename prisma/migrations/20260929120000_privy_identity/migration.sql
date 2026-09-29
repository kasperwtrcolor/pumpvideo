-- AlterTable
ALTER TABLE "Trader" ADD COLUMN     "email" TEXT,
ADD COLUMN     "loginMethod" TEXT,
ADD COLUMN     "privyDid" TEXT,
ADD COLUMN     "walletId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Trader_privyDid_key" ON "Trader"("privyDid");

-- CreateIndex
CREATE INDEX "Trader_privyDid_idx" ON "Trader"("privyDid");


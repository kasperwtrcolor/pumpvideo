-- CreateTable
CREATE TABLE "Coin" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PUMPFUN',
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "virtualSol" TEXT NOT NULL DEFAULT '0',
    "virtualToken" TEXT NOT NULL DEFAULT '0',
    "realSol" TEXT NOT NULL DEFAULT '0',
    "totalSupply" TEXT NOT NULL DEFAULT '0',
    "priceSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCapSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change24hPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holders" INTEGER NOT NULL DEFAULT 0,
    "volume24hSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "poolAddress" TEXT,
    "creator" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "launchedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricePoint" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "priceSol" DOUBLE PRECISION NOT NULL,
    "marketCapSol" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "videoUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "author" TEXT DEFAULT 'unclaimed',
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trader" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "walletAddress" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "practiceBalance" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "practiceStartBal" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "costSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "coinMint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PRACTICE',
    "solAmount" DOUBLE PRECISION NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "priceSol" DOUBLE PRECISION NOT NULL,
    "feeSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coin_mint_key" ON "Coin"("mint");

-- CreateIndex
CREATE INDEX "Coin_marketCapSol_idx" ON "Coin"("marketCapSol");

-- CreateIndex
CREATE INDEX "Coin_createdAt_idx" ON "Coin"("createdAt");

-- CreateIndex
CREATE INDEX "PricePoint_coinId_at_idx" ON "PricePoint"("coinId", "at");

-- CreateIndex
CREATE INDEX "Clip_coinId_idx" ON "Clip"("coinId");

-- CreateIndex
CREATE INDEX "Clip_rank_idx" ON "Clip"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "Trader_handle_key" ON "Trader"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Trader_walletAddress_key" ON "Trader"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Position_traderId_coinId_key" ON "Position"("traderId", "coinId");

-- CreateIndex
CREATE INDEX "Trade_traderId_createdAt_idx" ON "Trade"("traderId", "createdAt");

-- AddForeignKey
ALTER TABLE "PricePoint" ADD CONSTRAINT "PricePoint_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

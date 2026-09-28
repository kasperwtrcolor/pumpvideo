-- CreateTable
CREATE TABLE "Coin" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "priceSol" REAL NOT NULL DEFAULT 0,
    "marketCapSol" REAL NOT NULL DEFAULT 0,
    "change24hPct" REAL NOT NULL DEFAULT 0,
    "holders" INTEGER NOT NULL DEFAULT 0,
    "volume24hSol" REAL NOT NULL DEFAULT 0,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "poolAddress" TEXT,
    "creator" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "launchedAt" DATETIME,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coinId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "videoUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "caption" TEXT,
    "author" TEXT DEFAULT 'unclaimed',
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "rank" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Clip_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trader" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "walletAddress" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "practiceBalance" REAL NOT NULL DEFAULT 100,
    "practiceStartBal" REAL NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "costSol" REAL NOT NULL DEFAULT 0,
    "realizedSol" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Position_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "coinMint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PRACTICE',
    "solAmount" REAL NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "priceSol" REAL NOT NULL,
    "feeSol" REAL NOT NULL DEFAULT 0,
    "txSig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trade_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Coin_mint_key" ON "Coin"("mint");

-- CreateIndex
CREATE INDEX "Coin_marketCapSol_idx" ON "Coin"("marketCapSol");

-- CreateIndex
CREATE INDEX "Coin_createdAt_idx" ON "Coin"("createdAt");

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

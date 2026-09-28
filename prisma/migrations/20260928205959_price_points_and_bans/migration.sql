-- CreateTable
CREATE TABLE "PricePoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coinId" TEXT NOT NULL,
    "priceSol" REAL NOT NULL,
    "marketCapSol" REAL NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricePoint_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Coin" (
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
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "poolAddress" TEXT,
    "creator" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "launchedAt" DATETIME,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Coin" ("change24hPct", "complete", "createdAt", "creator", "description", "holders", "id", "imageUrl", "lastSyncedAt", "launchedAt", "marketCapSol", "mint", "name", "poolAddress", "priceSol", "provider", "realSol", "symbol", "telegram", "totalSupply", "twitter", "virtualSol", "virtualToken", "volume24hSol", "website") SELECT "change24hPct", "complete", "createdAt", "creator", "description", "holders", "id", "imageUrl", "lastSyncedAt", "launchedAt", "marketCapSol", "mint", "name", "poolAddress", "priceSol", "provider", "realSol", "symbol", "telegram", "totalSupply", "twitter", "virtualSol", "virtualToken", "volume24hSol", "website" FROM "Coin";
DROP TABLE "Coin";
ALTER TABLE "new_Coin" RENAME TO "Coin";
CREATE UNIQUE INDEX "Coin_mint_key" ON "Coin"("mint");
CREATE INDEX "Coin_marketCapSol_idx" ON "Coin"("marketCapSol");
CREATE INDEX "Coin_createdAt_idx" ON "Coin"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PricePoint_coinId_at_idx" ON "PricePoint"("coinId", "at");

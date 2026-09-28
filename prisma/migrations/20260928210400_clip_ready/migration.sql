-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "rank" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Clip_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Clip" ("author", "caption", "coinId", "comments", "createdAt", "id", "likes", "rank", "shares", "source", "thumbUrl", "videoUrl", "views") SELECT "author", "caption", "coinId", "comments", "createdAt", "id", "likes", "rank", "shares", "source", "thumbUrl", "videoUrl", "views" FROM "Clip";
DROP TABLE "Clip";
ALTER TABLE "new_Clip" RENAME TO "Clip";
CREATE INDEX "Clip_coinId_idx" ON "Clip"("coinId");
CREATE INDEX "Clip_rank_idx" ON "Clip"("rank");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

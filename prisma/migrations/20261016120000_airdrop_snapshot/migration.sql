-- $pemp airdrop — frozen eligibility snapshots.
--
-- Two additive tables. Neither is touched by the live app: the snapshot is
-- written once, by scripts/snapshot-airdrop.ts, and only ever read afterwards.
--
-- Why store the allocation instead of re-deriving it at claim time: the moment
-- $pemp trades, every incentive points at gaming whatever formula decides who is
-- owed what. A formula that can be re-run is a formula that can be re-argued.
-- Freezing the numbers, hashing them, and publishing the hash before the token
-- exists is what makes the split settle-able.
--
-- `criteria` is JSONB because it is the published ruleset (weights, threshold,
-- prose) stored verbatim alongside the numbers it produced — a later code change
-- must not be able to rewrite the terms people were promised.

CREATE TABLE "AirdropSnapshot" (
    "id"           TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "cutoff"       TIMESTAMP(3) NOT NULL,
    "criteria"     JSONB NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "totalWallets" INTEGER NOT NULL DEFAULT 0,
    "totalPoints"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokenPool"    DOUBLE PRECISION,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AirdropSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirdropSnapshot_label_key" ON "AirdropSnapshot"("label");

CREATE TABLE "AirdropAllocation" (
    "id"          TEXT NOT NULL,
    "snapshotId"  TEXT NOT NULL,
    "wallet"      TEXT NOT NULL,
    "points"      DOUBLE PRECISION NOT NULL,
    "sharePct"    DOUBLE PRECISION NOT NULL,
    "tokenAmount" DOUBLE PRECISION,
    "rank"        INTEGER NOT NULL,
    "traderId"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AirdropAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirdropAllocation_snapshotId_wallet_key" ON "AirdropAllocation"("snapshotId", "wallet");
CREATE INDEX "AirdropAllocation_wallet_idx" ON "AirdropAllocation"("wallet");
CREATE INDEX "AirdropAllocation_snapshotId_rank_idx" ON "AirdropAllocation"("snapshotId", "rank");

ALTER TABLE "AirdropAllocation"
    ADD CONSTRAINT "AirdropAllocation_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "AirdropSnapshot"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AirdropAllocation"
    ADD CONSTRAINT "AirdropAllocation_traderId_fkey"
    FOREIGN KEY ("traderId") REFERENCES "Trader"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

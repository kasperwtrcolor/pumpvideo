# Pemp

**Every clip is a coin you can buy.** A TikTok-style vertical feed where each clip is
bound to a Solana memecoin, with one-tap buying inline — practice with play money
first, no wallet required.

Built as a working MVP: real live market data from pump.fun, real bonding-curve
fills, real vertical clip pipeline. The only thing deliberately not wired is
spending actual SOL — see [Live trading](#live-trading-the-one-seam-that-isnt-wired).

---

## Run it

```bash
npm install
npx prisma migrate dev          # creates prisma/dev.db (SQLite)
npm run seed                    # pulls live pump.fun coins + renders a clip each
npm run dev                     # http://localhost:3000
```

`npm run seed` = `ingest` (pump.fun → DB) then `clips` (ffmpeg → vertical MP4).
First run takes a couple of minutes; it renders one 5s 720x1280 h264 clip per coin
at ~1s each with `--concurrency 2`.

### Production build

```bash
npm run typecheck && npm run build && npm run start
```

---

## What's real vs. what's stubbed

| Piece | Status |
| --- | --- |
| Vertical snap feed, infinite scroll, autoplay/visibility | **real** |
| Coin market data (price, mcap, reserves, graduation) | **real** — live pump.fun frontend API |
| Bonding-curve fills + 1% fee + slippage | **real math**, simulated custody |
| Practice accounts, positions, PnL, equity curve | **real** |
| Clip pipeline (image → 9:16 MP4 + thumb via ffmpeg) | **real** |
| Price history + 24h change | **real** (`PricePoint` rows from the market keeper) |
| Wallet connect (Phantom) + address linking | **real** |
| Live SOL swaps | **not wired** — `executeLiveFill()` throws |
| TikTok/YouTube clip ingestion | **not built** — clips are synthesised from coin art |

Nothing fakes a fill. `/api/trade` with `mode: "LIVE"` returns **501** rather than
pretending, and the UI says so.

---

## Deploying to Vercel

Vercel is serverless, so three things that work on a VM do **not** work there.
All three are already handled in this repo:

| Constraint | How it's handled |
| --- | --- |
| Read-only, ephemeral filesystem — SQLite cannot persist a write | Postgres via Prisma (`DATABASE_URL` pooled + `DIRECT_URL` direct) |
| Only files **in the repo** get deployed | `public/clips` + `public/thumbs` are committed (~4.4 MB) |
| `ffmpeg` cannot run in a serverless function | Clips are rendered locally and shipped as static assets |

### 1. Push to GitHub

```bash
git remote add origin git@github.com:<you>/pumpvideo.git
git push -u origin main
```

### 2. Import the repo on Vercel

Framework preset is detected as Next.js. The build command is pinned in
`vercel.json` to `prisma generate && next build` so the client is regenerated
(and built for Vercel's `rhel-openssl-3.0.x` runtime) on every deploy.

### 3. Attach Postgres

Project → **Storage** → **Create Database** → Postgres. Vercel injects
`POSTGRES_PRISMA_URL` (pooled) and `POSTGRES_URL_NON_POOLING` (direct) into the
project automatically. Add two env vars pointing at them:

```
DATABASE_URL = <POSTGRES_PRISMA_URL>          # pooled — required on serverless
DIRECT_URL   = <POSTGRES_URL_NON_POOLING>     # direct — migrations only
```

The pooled URL matters: without pgbouncer in front, concurrent serverless
invocations open a connection each and you hit Postgres' connection cap fast.

### 4. Create the schema and seed

```bash
DATABASE_URL=<POSTGRES_PRISMA_URL> \
DIRECT_URL=<POSTGRES_URL_NON_POOLING> npm run db:migrate
```

Then seed the live coins. Ingestion needs `ffmpeg`, so run it **locally** against
the remote DB and commit the rendered clips:

```bash
DATABASE_URL=<POSTGRES_PRISMA_URL> DIRECT_URL=<POSTGRES_URL_NON_POOLING> \
  npm run ingest && npm run clips
git add public/clips public/thumbs && git commit -m "seed clips" && git push
```

### 5. Set the remaining env vars

```
SOLANA_RPC_URL = https://mainnet.helius-rpc.com/?api-key=...   # public RPC rate-limits
CRON_SECRET    = $(openssl rand -hex 24)
```

### 6. Cron (the market keeper)

`vercel.json` registers `/api/sync` as a Vercel Cron target. `GET` is gated on
`CRON_SECRET` — Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically
once that env var exists. `GET` is required because Vercel Cron only issues GET.

> **Plan limit**: the schedule in `vercel.json` is daily because Vercel's **Hobby**
> tier restricts cron frequency. On Pro (or with any external scheduler — e.g.
> cron-job.org hitting `GET /api/sync?limit=40` with the bearer header) drop it to
> `*/5 * * * *` for a live price feed.

### Known limitations in this deployment

- Ingestion and clip rendering are **offline** steps, not runtime. New coins
  appear only when you re-run `npm run ingest && npm run clips` and push. Putting
  this on a schedule needs a worker (Railway/Fly) with ffmpeg — not Vercel.
- Live SOL swaps are not implemented (`executeLiveFill()` → 501).

---

## Architecture

```
pump.fun frontend API ──► scripts/ingest.ts ──► Coin  ──► scripts/gen-clips.ts ──► /public/clips/*.mp4
                                    │                                  │
                                    ▼                                  ▼
                                 PricePoint                        Clip (ready)
                                                                       │
   browser ──► /api/feed ─────────────────────────────────────────────┘
      │           │
      │           └─► lib/bonding-curve.ts   (constant product, k = vSol * vTok)
      ▼
   BuySheet ──► /api/trade ──► lib/trade-engine.ts ──► Position / Trade / Trader
                                     │
                                     └─► executeLiveFill()  ← the only stub
```

### Data model (`prisma/schema.prisma`)

- **Coin** — live market state, reserves held as raw integer *strings* (bigint-safe).
- **Clip** — one clip = one front door into a coin. `ready` gates it into the feed,
  so a queued-but-unrendered clip never ships a broken `<video>`.
- **PricePoint** — append-only history; powers the 24h change chip and PnL marks.
- **Trader** — anonymous by default (cookie), wallet linkable. Practice balance is
  the whole point: the app is fully usable with no wallet.
- **Position / Trade** — holdings and an immutable fill log with `mode` so practice
  and live fills live in one auditable table.

### The curve

pump.fun's bonding curve is a constant-product AMM over *virtual* reserves:

```
k = vSol * vTok
buy : tokensOut = vTok - k / (vSol + solIn)      (solIn net of 1% fee)
sell: solOut    = vSol - k / (vTok + tokenIn)    (net of 1% fee)
```

`lib/bonding-curve.ts` implements this in `bigint`. The client quotes with the same
module so the preview matches the fill; the server re-quotes inside a transaction
and is the source of truth. Practice buys **write the post-trade reserves back**,
so a wave of buys actually moves the price for the next viewer — the same feedback
loop the real product has, without spending SOL.

---

## Live trading (the one seam that isn't wired)

`lib/trade-engine.ts` exports `executeLiveFill()`. Its signature matches the
practice path on purpose, so the UI needs no branching. To finish it:

1. `npm i @pump-fun/pump-sdk` (already a dependency) and build the `buy`/`sell`
   instruction against the coin's `curvePubkey`/`mint`.
2. Sign with the wallet from `components/WalletButton.tsx` (Phantom, via
   `window.solana`) and send with `SOLANA_RPC_URL`.
3. Write the signature into `Trade.txSig` and flip `liveReady` to `true` in
   `/api/feed`.

Until then, `mode: "LIVE"` is rejected with a 501 and a human-readable reason.

---

## Market keeper

Reserves drift the moment you stop reading them. Run the keeper on a schedule:

```bash
npm run sync -- --limit 40        # or: npx tsx scripts/sync.ts --limit 40
```

```cron
*/5 * * * * cd /srv/pumpclip && npx tsx scripts/sync.ts --limit 40 >> /var/log/pumpclip-sync.log 2>&1
```

Same logic is exposed as `POST /api/sync` so the app can self-heal on load without
a scheduler. It is idempotent.

---

## The TikTok ingest seam

Pemp's real moat is scraping viral clips and binding them to coins. This repo
deliberately stops short of that — synthesising a clip from the coin's own art
instead, which keeps the pipeline shape identical:

```
source video ──► ffmpeg (9:16, HLS ladder) ──► object storage ──► Clip.videoUrl
                                    ▲
                                    └─ here is where a scraper drops a TikTok URL
```

To plug one in: write `Clip` rows with `source: "TIKTOK"` and an HLS `videoUrl`,
set `ready`, and the feed serves them with no other change.

---

## Notes / gotchas

- **Next.js 16**: `params` is a Promise (`await params` / `use(params)`), Turbopack
  is the default bundler, `middleware` is `proxy`. Docs ship in
  `node_modules/next/dist/docs/`.
- **Identity bug to not reintroduce**: calling `resolveTrader()` twice in one
  request creates two rows for a cookieless visitor — the write lands on one trader
  and the cookie points at another, silently dropping every first trade. Always pass
  the trader you already resolved into `withTrader(body, { trader, created })`.
- **SQLite** is for local dev only (write contention). Swap `datasource.provider`
  to `postgresql` for prod; no model changes needed.
- **pump.fun API sort values** are literal: `market_cap`, `created_timestamp`,
  `last_trade_timestamp`, `ath_market_cap`, `reply_count`. `created` 400s.
- **Image hosts**: some coin images are X/Twitter CDN links that 403. The clip
  generator falls back to a text-only gradient card, so rendering never fails.

---

## Screens

- `/` — vertical clip feed. Hot / New / Top, mute toggle, rail actions, buy sheet.
- `/coins` — coin index. Sort, search, graduation filter, header stats.
- `/coin/[symbol]` — coin detail: clip hero, market state, clips, live fills, position.
- `/portfolio` — practice book: equity, positions with PnL, sell, fill history.

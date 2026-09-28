import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { fetchCoinsByMints, toCoinRecord } from "@/lib/pumpfun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The market keeper. Pulls fresh reserves from pump.fun for the coins in play,
 * appends a PricePoint, and recomputes 24h change from that history.
 *
 *   POST /api/sync   { mints?: string[], limit?: number }   — app-driven, no auth
 *   GET  /api/sync   ?limit=40                              — Vercel Cron target
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation when
 * CRON_SECRET is set in the project env, so GET is gated on it. GET is required
 * because Vercel Cron can only issue GET requests.
 */
async function runSync(opts: { mints?: string[]; limit: number }) {
  const coins = opts.mints?.length
    ? await prisma.coin.findMany({ where: { mint: { in: opts.mints } } })
    : await prisma.coin.findMany({
        where: { isBanned: false, complete: false },
        orderBy: { marketCapSol: "desc" },
        take: opts.limit,
      });

  if (coins.length === 0) {
    return { ok: true, checked: 0, updated: 0, notFound: 0, errors: [] as string[] };
  }

  // One sweep resolves every mint we care about — there is no by-mint endpoint,
  // so per-coin lookups would be N list sweeps instead of one.
  const live = await fetchCoinsByMints(coins.map((c) => c.mint));

  let updated = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const coin of coins) {
    const record = live.get(coin.mint);
    if (!record) {
      // Fell out of both rankings, or whyever pump.fun stopped serving it.
      // Counted and surfaced — never silently skipped.
      notFound++;
      continue;
    }
    try {
      const mapped = toCoinRecord(record);

      const since24h = await prisma.pricePoint.findFirst({
        where: {
          coinId: coin.id,
          at: { lte: new Date(Date.now() - 23 * 3600_000) },
        },
        orderBy: { at: "desc" },
      });
      const baseline =
        since24h ??
        (await prisma.pricePoint.findFirst({
          where: { coinId: coin.id },
          orderBy: { at: "asc" },
        }));

      const change24hPct =
        baseline && baseline.priceSol > 0
          ? ((mapped.priceSol - baseline.priceSol) / baseline.priceSol) * 100
          : coin.change24hPct;

      await prisma.coin.update({
        where: { id: coin.id },
        data: { ...mapped, change24hPct, isBanned: Boolean(record.is_banned) },
      });
      await prisma.pricePoint.create({
        data: {
          coinId: coin.id,
          priceSol: mapped.priceSol,
          marketCapSol: mapped.marketCapSol,
        },
      });
      updated++;
    } catch (e) {
      errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  return {
    ok: true,
    checked: coins.length,
    updated,
    notFound, // checked - updated - errors
    errors: errors.slice(0, 5),
  };
}

export async function POST(req: NextRequest) {
  let mints: string[] | undefined;
  let limit = 24;
  try {
    const body = (await req.json()) as { mints?: string[]; limit?: number };
    mints = body.mints?.slice(0, 40);
    if (body.limit) limit = Math.min(40, Math.max(1, body.limit));
  } catch {
    // empty body is fine
  }

  return withTrader(await runSync({ mints, limit }));
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
  }

  const limit = Math.min(
    40,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 40),
  );

  const result = await runSync({ limit });
  // Cron responses are read by operators, not the app — no trader cookie here.
  return Response.json(result);
}

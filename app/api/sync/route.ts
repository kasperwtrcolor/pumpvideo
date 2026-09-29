import type { NextRequest } from "next/server";
import { withTrader } from "@/lib/api";
import { runKeeper } from "@/lib/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The market keeper. See lib/keeper.ts for the refresh strategy.
 *
 *   POST /api/sync   { mints?: string[], limit?: number }   — app-driven, no auth
 *   GET  /api/sync   ?limit=40                              — Vercel Cron target
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every invocation
 * when CRON_SECRET is set, so GET is gated on it. GET is required because Vercel
 * Cron can only issue GET requests.
 *
 * NOTE: Vercel Hobby cron runs at most once per day. The real 5-minute cadence
 * is driven from the VPS (scripts/sync-cron.sh); this endpoint is the fallback.
 */
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

  return withTrader(await runKeeper({ mints, limit }));
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

  const result = await runKeeper({ limit });
  // Cron responses are read by operators, not the app — no trader cookie here.
  return Response.json(result);
}

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

  // Fail CLOSED. An auth gate that silently disables itself when its env var is
  // missing is worse than no gate: the endpoint looks protected in code review
  // while being wide open in production. That is exactly what happened here —
  // CRON_SECRET was never set on the Vercel project, so anyone could trigger a
  // full keeper sweep and burn RPC + pump.fun rate limits.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "NOT_CONFIGURED", detail: "CRON_SECRET is not set on this deployment" },
        { status: 503 },
      );
    }
    // Local dev: no secret configured, allow it so `npm run sync` style work
    // isn't blocked on setup.
  } else {
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

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { quotesFor } from "@/lib/quotes";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotes?mints=<mint,mint,...>
 *
 * Live prices for the clips on screen. The feed polls this on a timer so the
 * market numbers move without a reload. Read-only and unauthenticated: nothing
 * here is per-trader, and the response is a plain price map.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("mints") ?? "";
  const mints = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (mints.length === 0) {
    return NextResponse.json({ quotes: {} }, { headers: { "cache-control": "no-store" } });
  }

  try {
    const quotes = await quotesFor(mints);
    return NextResponse.json({ quotes }, { headers: { "cache-control": "no-store" } });
  } catch {
    // The ticker is decorative — never let it 500 the page into an error state.
    return NextResponse.json({ quotes: {} }, { headers: { "cache-control": "no-store" } });
  }
}

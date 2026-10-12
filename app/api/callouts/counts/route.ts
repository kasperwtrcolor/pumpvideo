import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchCalloutCounts } from "@/lib/pumpfun";
import type { CalloutCountsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** How many coins one request may ask about, so a hostile query can't fan out. */
const MAX_MINTS = 24;

/**
 * GET /api/callouts/counts?mints=<mint,mint,...>
 *
 * How many callouts each of these coins has, for the feed's rail badge. The
 * feed polls this alongside `/api/quotes` so the number on the comment icon
 * tracks the coin rather than sitting at whatever the last page load said.
 *
 * Public and unauthenticated: a callout count is not per-trader. Coins whose
 * read failed are omitted from `counts` rather than reported as zero, so the
 * client can tell "no callouts" from "we could not look".
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("mints") ?? "";
  const mints = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_MINTS);

  if (mints.length === 0) {
    return NextResponse.json({ counts: {} } satisfies CalloutCountsResponse, {
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const counts = await fetchCalloutCounts(mints);
    const body: CalloutCountsResponse = { counts };
    return NextResponse.json(body, {
      headers: {
        // Counts move slowly and the upstream read is one request per coin, so
        // a shared cache is what keeps a busy feed from hammering pump.fun.
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    // A badge is ambient — never 500 the feed over it.
    return NextResponse.json({ counts: {} } satisfies CalloutCountsResponse, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }
}

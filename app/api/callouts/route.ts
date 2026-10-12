import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchCallouts } from "@/lib/pumpfun";
import type { CalloutSort, CalloutsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/callouts?mint=<mint>&sort=top|latest
 *
 * The callouts for one coin — a public, unauthenticated read of pump.fun's own
 * callout feed, reshaped into the fields the rail renders. Nothing here is
 * per-trader, so there is no session and no cookie.
 *
 * `sort=top` ranks by the size of the caller's position (largest holdings
 * first); `sort=latest` ranks by when the call was posted. Both are the
 * upstream endpoint's own orderings rather than a re-sort here, so the ranking
 * matches what pump.fun itself would show.
 */
export async function GET(req: NextRequest) {
  const mint = (req.nextUrl.searchParams.get("mint") ?? "").trim();
  const sortParam = req.nextUrl.searchParams.get("sort");
  const sort: CalloutSort = sortParam === "latest" ? "latest" : "top";

  if (!mint) {
    return NextResponse.json({ error: "NO_MINT" }, { status: 400 });
  }

  try {
    const { rows, total, hasMore } = await fetchCallouts(mint, { sort, limit: 20 });
    const body: CalloutsResponse = { callouts: rows, total, hasMore, sort };

    return NextResponse.json(body, {
      headers: {
        // Shared cache, short window. Callouts move, but not second-to-second,
        // and every sheet open for the same coin would otherwise be a fresh
        // upstream hit — pump.fun rate-limits this endpoint readily.
        "cache-control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    });
  } catch {
    // A coin with no callouts and a rate-limited request look the same to the
    // rail: both mean "nothing to show right now". Never 500 the sheet open.
    return NextResponse.json(
      { callouts: [], total: 0, hasMore: false, sort } satisfies CalloutsResponse,
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}

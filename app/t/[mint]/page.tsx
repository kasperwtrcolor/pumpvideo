import { Feed } from "@/components/Feed";
import { solUsd } from "@/lib/sol-price";
import { prisma } from "@/lib/db";
import { VISIBLE_COIN } from "@/lib/visibility";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * One token's clip wall.
 *
 * `/t/[mint]` is the answer to "show me every clip of this coin", and it is the
 * canonical share target: a permalink carries the mint (never the symbol, which
 * is not unique — several live tokens already share one) plus an optional
 * `?clip=` naming the exact clip to open on.
 *
 * It renders the same <Feed> as the home wall, narrowed to the token. That is
 * deliberate: the swiper, the rail, buying, liking, commenting and sharing are
 * all identical, so a token's clips behave exactly like the global wall minus
 * the parts that describe *which* tokens to draw from.
 *
 * The header lookup is why this is a server component: it resolves the ticker
 * before the first clip lands, so the chrome reads "$BONK" immediately instead
 * of flashing an empty label while the client fetches page one.
 */
export default async function TokenWall({
  params,
  searchParams,
}: {
  params: Promise<{ mint: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mint } = await params;
  const sp = await searchParams;
  const usd = await solUsd();

  const coin = await prisma.coin.findFirst({
    where: { ...VISIBLE_COIN, mint },
    select: { symbol: true, name: true },
  });

  if (!coin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="font-bold">No token for that address.</p>
        <p className="text-xs text-muted">The link may be stale, or the token was removed.</p>
        <Link href="/coins" className="mt-2 text-xs text-accent">
          back to coins
        </Link>
      </div>
    );
  }

  const clip = typeof sp.clip === "string" ? sp.clip : undefined;
  const share = sp.share === "1";

  return (
    <Feed
      initialSolUsd={usd}
      mint={mint}
      tokenSymbol={coin.symbol}
      focusClipId={clip}
      autoShare={share}
    />
  );
}

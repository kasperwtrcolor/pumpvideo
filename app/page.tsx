import { Feed } from "@/components/Feed";
import { Landing } from "@/components/Landing";
import { solUsd } from "@/lib/sol-price";
import { landingTiles } from "@/lib/landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const usd = await solUsd();

  /**
   * The welcome screen is always rendered, and it is rendered here on the
   * server rather than gated in the client.
   *
   * Two reasons. It is shown on every load of `/` — a refresh is a fresh
   * decision, so a returning visitor gets it again — and the client's first
   * paint has to agree with the server's or the feed would flash before the
   * overlay appeared. `lib/welcome.ts` starts open, `Landing` closes it on
   * dismiss or sign-in, and `Feed` reopens it at the watch milestone.
   *
   * The wall's artwork is fetched whenever the screen is drawn, which is now
   * always: it is the first thing anyone sees, so it cannot be the thing that
   * arrives late.
   */
  const tiles = await landingTiles();

  return (
    <>
      <Feed initialSolUsd={usd} />
      <Landing tiles={tiles} />
    </>
  );
}

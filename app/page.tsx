import { HomeView } from "@/components/HomeView";
import { solUsd } from "@/lib/sol-price";
import { landingTiles } from "@/lib/landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const usd = await solUsd();
  const tiles = await landingTiles();

  // Which arrangement renders — the phone wall or the wide four-region feed —
  // is decided in HomeView by the viewport, so the server does not have to
  // guess. Both get the same first-paint data.
  return <HomeView initialSolUsd={usd} tiles={tiles} />;
}

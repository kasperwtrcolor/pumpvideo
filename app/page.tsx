import { cookies } from "next/headers";
import { Feed } from "@/components/Feed";
import { Landing } from "@/components/Landing";
import { solUsd } from "@/lib/sol-price";
import { landingTiles } from "@/lib/landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const usd = await solUsd();

  /**
   * The welcome screen is decided here, on the server, rather than in the
   * component. Rendering it conditionally in the client would mean a visible
   * frame of the wrong thing for everybody: a first-time visitor would see the
   * feed flash before the overlay appeared, and a returning one would see the
   * overlay flash before it was removed. Reading the dismissal cookie before
   * anything is painted avoids both.
   *
   * The wall's artwork is only fetched on the branch that needs it, so a
   * returning visitor never pays for a query they will not see.
   */
  const seen = (await cookies()).has("pumpclip_welcome");
  if (seen) return <Feed initialSolUsd={usd} />;

  const tiles = await landingTiles();
  return (
    <>
      <Feed initialSolUsd={usd} />
      <Landing tiles={tiles} />
    </>
  );
}

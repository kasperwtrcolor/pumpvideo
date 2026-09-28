import { Feed } from "@/components/Feed";
import { solUsd } from "@/lib/sol-price";

export const dynamic = "force-dynamic";

export default async function Home() {
  const usd = await solUsd();
  return <Feed initialSolUsd={usd} />;
}

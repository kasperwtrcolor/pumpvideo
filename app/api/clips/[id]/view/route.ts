import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/clips/[id]/view — count a real watch.
 *
 * No login: a view is an impression, not an action by an identified person.
 * The client fires this once per clip when it actually starts playing, so the
 * number reflects watches rather than feed renders. Rate limited per client so
 * it can't be trivially inflated.
 *
 * Deliberately does NOT return the new total — the UI shows the count it
 * already has plus one, and hiding the total removes any incentive to spam it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const limit = rateLimit(`view:${clientKey(req)}`, 120, 60_000);
  if (!limit.ok) return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 });

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  await prisma.clip.update({ where: { id }, data: { views: { increment: 1 } } });
  return NextResponse.json({ ok: true });
}

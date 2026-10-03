import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { deleteObject, objectFromDownloadUrl } from "@/lib/gcs";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/clips/[id] — remove one of your own clips.
 *
 * Owner-only, and enforced here rather than in the UI: the button is a
 * convenience, this is the rule. A clip you did not upload returns 403 whether
 * or not you can see it.
 *
 * What deletion does and does not touch:
 *   - the Clip row goes, cascading to its likes, comments, shares, favorites and
 *     the notifications pointing at it (see the relations in schema.prisma);
 *   - the uploaded video file is removed from storage, so "delete" reclaims the
 *     bytes and not just the row;
 *   - the Coin, any Position, and the Trade ledger are untouched. A clip is a
 *     front door into a token, not the token; and the creator-fee rows carry the
 *     wallet that was paid precisely so this record survives (see Trade in the
 *     schema). Deleting a clip must not rewrite what someone was already paid.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const clip = await prisma.clip.findUnique({
    where: { id },
    select: { id: true, uploadedById: true, videoUrl: true },
  });
  if (!clip) {
    return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });
  }
  // A seeded or ingest-created clip has no owner and is not deletable from here;
  // those are the catalog's, and the retention sweep is what manages them.
  if (clip.uploadedById !== trader.id) {
    return NextResponse.json(
      { error: "NOT_YOUR_CLIP", detail: "that clip is not yours to delete" },
      { status: 403 },
    );
  }

  // Remove the file first, best-effort.
  //
  // Best-effort on purpose: the row is what the user asked to disappear, and a
  // storage hiccup must not leave a clip they deleted still playing in the feed.
  // An orphaned object costs a few megabytes; a clip that refuses to die reads
  // as a broken app. A retryable sweep to reconcile orphaned objects is a
  // separate concern.
  const object = clip.videoUrl ? objectFromDownloadUrl(clip.videoUrl) : null;
  if (object) {
    try {
      await deleteObject(object);
    } catch (e) {
      console.warn(`clip delete: storage cleanup failed for ${object}: ${(e as Error).message}`);
    }
  }

  await prisma.clip.delete({ where: { id } });

  return NextResponse.json({ ok: true, deleted: id });
}

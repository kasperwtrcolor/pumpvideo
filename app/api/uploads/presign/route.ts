import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import {
  ALLOWED_VIDEO_TYPES,
  MAX_UPLOAD_BYTES,
  clipObjectPath,
  downloadTokenFor,
  signUploadUrl,
  storageConfigured,
} from "@/lib/gcs";

export const dynamic = "force-dynamic";

const Body = z.object({
  contentType: z.string().min(1).max(64),
  sizeBytes: z.number().int().positive(),
});

/**
 * POST /api/uploads/presign — get a short-lived URL to upload one video.
 *
 * Login required. The URL is scoped to a single object path inside this
 * trader's own folder, so one user cannot overwrite another's clip even if they
 * somehow obtain a URL.
 *
 * The declared size is checked here so an obviously oversized file is refused
 * before any bytes move — but that check is a courtesy, not the enforcement. The
 * real one happens at registration, where the object's actual stored size is
 * read back from storage.
 */
export async function POST(req: NextRequest) {
  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "STORAGE_NOT_CONFIGURED", detail: "video uploads are not configured on this deployment" },
      { status: 503 },
    );
  }

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const limit = rateLimit(`presign:${clientKey(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many uploads, wait a moment" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  if (!ALLOWED_VIDEO_TYPES.includes(parsed.contentType as (typeof ALLOWED_VIDEO_TYPES)[number])) {
    return NextResponse.json(
      { error: "BAD_TYPE", detail: `unsupported video type: ${parsed.contentType}` },
      { status: 415 },
    );
  }

  if (parsed.sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "TOO_LARGE",
        detail: `videos must be ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB or smaller`,
        maxBytes: MAX_UPLOAD_BYTES,
      },
      { status: 413 },
    );
  }

  const ext = parsed.contentType.split("/")[1] ?? "mp4";
  const object = clipObjectPath(trader.id, ext);

  const signed = signUploadUrl({
    object,
    contentType: parsed.contentType,
    expiresInSec: 900,
    metadata: { firebaseStorageDownloadTokens: downloadTokenFor(object) },
  });

  return NextResponse.json({
    ok: true,
    object,
    uploadUrl: signed.url,
    headers: signed.headers,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSec: 900,
  });
}

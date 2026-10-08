import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import {
  ALLOWED_LAUNCH_TYPES,
  MAX_UPLOAD_BYTES,
  downloadTokenFor,
  launchObjectPath,
  signUploadUrl,
  storageConfigured,
} from "@/lib/gcs";

export const dynamic = "force-dynamic";

const Body = z.object({
  contentType: z.string().min(1).max(64),
  sizeBytes: z.number().int().positive(),
});

/**
 * POST /api/launch/presign — a short-lived URL to upload one launch asset.
 *
 * Same signed-PUT arrangement as a clip (`/api/uploads/presign`): login
 * required, scoped to one object inside this trader's own `launch/` folder, and
 * the declared size checked here as a courtesy (the real gate is the stored
 * size read back at confirm time). The one difference is that a launch may
 * upload an image as well as a video — a coin needs art, and that art is either
 * an uploaded image or a frame the browser pulled from the uploaded video.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "STORAGE_NOT_CONFIGURED", detail: "uploads are not configured on this deployment" },
      { status: 503 },
    );
  }

  const limit = rateLimit(`launchpresign:${clientKey(req)}`, 20, 60_000);
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

  if (!ALLOWED_LAUNCH_TYPES.includes(parsed.contentType as (typeof ALLOWED_LAUNCH_TYPES)[number])) {
    return NextResponse.json(
      { error: "BAD_TYPE", detail: `unsupported type: ${parsed.contentType}` },
      { status: 415 },
    );
  }

  if (parsed.sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "TOO_LARGE",
        detail: `files must be ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB or smaller`,
        maxBytes: MAX_UPLOAD_BYTES,
      },
      { status: 413 },
    );
  }

  const ext = parsed.contentType.split("/")[1] ?? "bin";
  const object = launchObjectPath(trader.id, ext);

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

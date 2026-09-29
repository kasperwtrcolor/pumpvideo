/**
 * Google Cloud Storage / Firebase Storage uploads.
 *
 * Firebase Storage is GCS underneath. Rather than pull in the Firebase SDK, we
 * sign V4 upload URLs with the service account's RSA key and hand them to the
 * browser. The browser then PUTs the video straight to Google.
 *
 * Two things this buys us:
 *   - the file never passes through a Vercel function, so the 4.5 MB request
 *     body cap that would otherwise make video uploads impossible does not apply
 *   - no Firebase Auth and no Storage security rules are involved at all: a
 *     signed URL is authorised by the signing identity, and our own API is the
 *     gatekeeper (it requires a verified login before it will sign anything)
 *
 * The private key never leaves the server. Nothing here is ever sent to a client
 * except a short-lived URL scoped to one object path.
 */
import crypto from "node:crypto";

const ALGORITHM = "GOOG4-RSA-SHA256";
const SERVICE = "storage";
const HOST = "storage.googleapis.com";

/** Hard cap on a single uploaded clip. ~30-60s of phone video. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

let cached: ServiceAccount | null | undefined;

/**
 * Credentials come from an env var only.
 *
 * Deliberately NOT falling back to reading a file from disk: a `readFileSync`
 * with a variable path makes Next's file tracer include the entire project in
 * every serverless bundle — which here would mean shipping all the seeded clips
 * and thumbnails inside the function. `scripts/with-firebase-env.sh` loads the
 * local key file into this variable for development instead.
 */
export function serviceAccount(): ServiceAccount | null {
  if (cached !== undefined) return cached;

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      cached = JSON.parse(inline) as ServiceAccount;
      return cached;
    } catch {
      cached = null;
      return null;
    }
  }

  cached = null;
  return null;
}

export function storageBucket(): string {
  return process.env.FIREBASE_STORAGE_BUCKET?.trim() || "";
}

export function storageConfigured(): boolean {
  return Boolean(serviceAccount() && storageBucket());
}

/** RFC 3986 encoding, which is what GCS V4 requires (stricter than encodeURIComponent). */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(bucket: string, object: string): string {
  return `/${uriEncode(bucket)}/${object.split("/").map(uriEncode).join("/")}`;
}

/** `20260929T120000Z` — the compact timestamp V4 signing wants. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export type SignedUrl = { url: string; headers: Record<string, string> };

/**
 * Sign a PUT the browser can use to upload one object.
 *
 * `metadata` is attached as x-goog-meta-* headers and therefore covered by the
 * signature — a client cannot smuggle extra metadata in after the fact.
 */
export function signUploadUrl(opts: {
  object: string;
  contentType: string;
  expiresInSec?: number;
  metadata?: Record<string, string>;
}): SignedUrl {
  const sa = serviceAccount();
  const bucket = storageBucket();
  if (!sa) throw new Error("no Firebase service account configured");
  if (!bucket) throw new Error("no Firebase storage bucket configured");

  const now = new Date();
  const ts = stamp(now);
  const date = ts.slice(0, 8);
  const scope = `${date}/auto/${SERVICE}/goog4_request`;
  const credential = `${sa.client_email}/${scope}`;

  const canonicalUri = encodeObjectPath(bucket, opts.object);

  const headers: [string, string][] = [
    ["host", HOST],
    ["content-type", opts.contentType],
  ];
  for (const [k, v] of Object.entries(opts.metadata ?? {})) {
    headers.push([`x-goog-meta-${k.toLowerCase()}`, v]);
  }
  headers.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const signedHeaders = headers.map(([k]) => k).join(";");
  const canonicalHeaders = headers.map(([k, v]) => `${k}:${v}\n`).join("");

  const query: [string, string][] = [
    ["X-Goog-Algorithm", ALGORITHM],
    ["X-Goog-Credential", credential],
    ["X-Goog-Date", ts],
    ["X-Goog-Expires", String(opts.expiresInSec ?? 900)],
    ["X-Goog-SignedHeaders", signedHeaders],
  ];
  query.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    ts,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(stringToSign), sa.private_key)
    .toString("hex");

  const outHeaders: Record<string, string> = {};
  for (const [k, v] of headers) if (k !== "host") outHeaders[k] = v;

  return {
    url: `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`,
    headers: outHeaders,
  };
}

/**
 * The URL a clip is served from.
 *
 * Uses a Firebase download token rather than a signed URL: a signed URL expires,
 * and a feed's videos must keep playing months later. The token is generated by
 * us and embedded at upload time, which is also why this needs no public bucket
 * and no Storage security rule.
 */
export function downloadUrl(object: string, token: string): string {
  const bucket = storageBucket();
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${uriEncode(object)}?alt=media&token=${token}`;
}

/**
 * Derive the download token for an object.
 *
 * Deterministic, not random, on purpose: the token has to be embedded in the
 * upload's signed metadata *before* the file exists, and reconstructed later
 * when the clip is registered. Deriving it from a server-side secret means the
 * client never has to be trusted to hand the token back — it cannot forge one
 * for an object it does not own.
 */
export function downloadTokenFor(object: string): string {
  const sa = serviceAccount();
  const secret =
    process.env.UPLOAD_TOKEN_SECRET?.trim() ||
    (sa ? crypto.createHash("sha256").update(sa.private_key).digest("hex") : "");
  if (!secret) throw new Error("no secret available to derive an upload token");
  return crypto.createHmac("sha256", secret).update(object).digest("hex").slice(0, 32);
}

/** Object path for a clip: one folder per uploader, named by a random id. */
export function clipObjectPath(ownerId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() || "mp4";
  return `clips/${ownerId}/${crypto.randomUUID()}.${safeExt}`;
}

/** True when `object` is inside this owner's folder — the ownership check. */
export function objectOwnedBy(object: string, ownerId: string): boolean {
  return object.startsWith(`clips/${ownerId}/`) && !object.includes("..");
}

/**
 * Mint a Google OAuth access token from the service account.
 *
 * Only needed for *administration* (bucket CORS), not for signing. The classic
 * JWT-bearer flow — we sign the assertion ourselves rather than pulling in
 * google-auth-library.
 */
export async function accessToken(): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new Error("no Firebase service account configured");

  const iat = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.full_control",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  })}`;
  const assertion = `${unsigned}.${crypto
    .sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key)
    .toString("base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`token exchange failed: ${json.error_description ?? res.status}`);
  }
  return json.access_token;
}

/**
 * Allow browsers to upload to this bucket from our own origins.
 *
 * A cross-origin PUT triggers a preflight, so without this the browser blocks
 * the upload before a byte leaves the page — the failure looks like a network
 * error in devtools and is easy to misdiagnose. Deliberately only our origins,
 * never `*`: the bucket is the thing holding user uploads.
 *
 * `responseHeader` is doing double duty here, and that is not a mistake. It
 * reads like "headers the browser may expose to JS" (Access-Control-Expose-
 * Headers), but GCS *also* uses it as the allowlist for
 * Access-Control-Allow-Headers on the preflight. A request header that is not
 * in this list makes GCS drop every CORS header from the preflight response,
 * so the browser refuses to send the PUT at all — with a perfectly valid
 * signature and a 200 from GCS every time you test it with curl.
 *
 * That is why `x-goog-meta-firebasestoragedownloadtokens` has to be listed: we
 * sign the upload with that header (it is how the clip gets its permanent
 * download token). Omit it and uploads fail in the browser and nowhere else.
 */
export const UPLOAD_META_HEADER = "x-goog-meta-firebasestoragedownloadtokens";

export async function setBucketCors(
  origins: string[],
): Promise<{ ok: boolean; detail?: string }> {
  const token = await accessToken();
  const bucket = storageBucket();
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=cors`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        cors: [
          {
            origin: origins,
            method: ["PUT", "POST", "GET", "HEAD", "OPTIONS"],
            responseHeader: ["Content-Type", "Content-Length", "ETag", "Range", UPLOAD_META_HEADER],
            maxAgeSeconds: 3600,
          },
        ],
      }),
    },
  );
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, detail: `${res.status} ${text.slice(0, 300)}` };
}

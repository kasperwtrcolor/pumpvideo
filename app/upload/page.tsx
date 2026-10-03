"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useTrader } from "@/components/TraderProvider";
import { sym } from "@/lib/format";

/** Must match MAX_UPLOAD_BYTES in lib/gcs.ts. The server is the real gate. */
const MAX_MB = 25;
const MAX_BYTES = MAX_MB * 1024 * 1024;

type Phase = "idle" | "uploading" | "registering" | "done";

/** PUT the file to the signed URL, reporting progress. fetch() can't do this. */
function uploadWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload rejected by storage (${xhr.status})`));
    xhr.onerror = () => reject(new Error("upload failed — check your connection"));
    xhr.send(file);
  });
}

/** Pull the human-readable error out of an API response. */
async function failure(res: Response, fallback: string): Promise<Error> {
  try {
    const j = (await res.json()) as { detail?: string; error?: string };
    return new Error(j.detail || j.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

export default function UploadPage() {
  const { toast } = useTrader();
  const { login, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tokenAddress, setTokenAddress] = useState("");
  /**
   * The token handed over by the feed's "clip" action, if any.
   *
   * Held separately from `tokenAddress` so the field can be *locked* while it is
   * set: arriving here from a clip means the token is already decided, and the
   * one thing left to do is choose a video. Editing the address is still one tap
   * away ("change"), but it is no longer the default question the page asks.
   */
  const [tokenFromUrl, setTokenFromUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ symbol: string; mint: string } | null>(null);

  // Read `?token=` off the URL rather than through `useSearchParams`: that hook
  // forces a Suspense boundary and de-opts the page to dynamic rendering for
  // what is a one-shot read. `location` is only touched after hydration, so the
  // prerender is unaffected.
  useEffect(() => {
    const hint = new URLSearchParams(window.location.search).get("token")?.trim();
    if (!hint) return;
    setTokenFromUrl(hint);
    setTokenAddress(hint);
  }, []);

  const pick = useCallback(
    (f: File | null) => {
      setMessage(null);
      setDone(null);
      if (!f) return setFile(null);
      if (!f.type.startsWith("video/")) {
        toast("that is not a video file", "bad");
        return setFile(null);
      }
      if (f.size > MAX_BYTES) {
        toast(`videos must be ${MAX_MB} MB or smaller`, "bad");
        return setFile(null);
      }
      setFile(f);
    },
    [toast],
  );

  const start = useCallback(async () => {
    if (!file) return;
    if (!tokenAddress.trim()) {
      setMessage("Enter the token address this clip belongs to.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setDone(null);
    setPct(0);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("session expired — log in again");
      const auth = { authorization: `Bearer ${token}` };

      // 1. Ask the server to sign a one-object upload URL.
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      });
      if (!presignRes.ok) throw await failure(presignRes, "could not start the upload");
      const presign = (await presignRes.json()) as {
        object: string;
        uploadUrl: string;
        headers: Record<string, string>;
      };

      // 2. Send the bytes straight to storage — never through our servers, which
      //    is what sidesteps the serverless request-size limit.
      await uploadWithProgress(presign.uploadUrl, presign.headers, file, setPct);

      // 3. Bind it to the token.
      const regRes = await fetch("/api/clips", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          object: presign.object,
          tokenAddress: tokenAddress.trim(),
          caption: caption.trim() || undefined,
        }),
      });
      if (!regRes.ok) throw await failure(regRes, "the upload could not be registered");
      const reg = (await regRes.json()) as {
        coin: { symbol: string; mint: string };
        clip: { id: string };
      };

      setDone(reg.coin);
      toast("clip is live", "ok");
      // Go straight to the clip with the share sheet already open. The upload is
      // not finished when the bytes land — a creator's next move is to send it
      // somewhere, and making them hunt for their own clip first is the step
      // where that gets abandoned.
      router.push(`/t/${reg.coin.mint}?clip=${encodeURIComponent(reg.clip.id)}&share=1`);
    } catch (e) {
      const m = (e as Error).message;
      setMessage(m);
      toast(m, "bad");
    } finally {
      setBusy(false);
    }
  }, [file, tokenAddress, caption, getAccessToken, toast]);

  if (!authenticated) {
    return (
      <div className="no-scrollbar h-full overflow-y-auto">
        <div className="mx-auto max-w-md px-4 pb-24 pt-6 text-center">
          <h1 className="text-2xl font-black tracking-tight">Upload a clip</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {tokenFromUrl
              ? "Log in and your video goes straight onto the token you were just watching — and you earn 1% of every buy that comes through it."
              : "Upload a short vertical video, point it at a token address, and anyone who buys that token through your clip pays you 1% of the buy. You need an account so the fee knows where to go."}
          </p>
          <button
            onClick={() => void login()}
            className="mt-5 rounded-xl burn-gradient px-5 py-3 text-sm font-black text-black"
          >
            Log in to upload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-md px-4 pb-24 pt-4">
        <h1 className="text-2xl font-black tracking-tight">Upload a clip</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {tokenFromUrl
            ? "Your clip will be bound to the token you were watching. Buyers who arrive through it pay you 1% of the buy, taken in SOL at the same moment as their swap."
            : "Bind a video to a token address. Buyers who arrive through your clip pay you 1% of the buy, taken in SOL at the same moment as their swap."}
        </p>

        {/* The token carried in from the feed. Shown as a settled fact rather
            than a field to fill in, because it is one: they already chose this
            coin by tapping "clip" on it. */}
        {tokenFromUrl && (
          <div className="mt-5 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-accent">
              Clipping for this token
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-ink">{tokenFromUrl}</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-[10px] text-muted">Carried over from the clip you watched.</span>
              <button
                onClick={() => setTokenFromUrl(null)}
                disabled={busy}
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[10px] font-bold text-muted hover:text-ink disabled:opacity-50"
              >
                change
              </button>
            </div>
          </div>
        )}

        {/* file picker */}
        <div className="mt-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">video</div>
          <div className="mt-2 rounded-2xl border border-dashed border-line bg-panel p-4 text-center">
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <div className="truncate text-sm font-bold">{file.name}</div>
                <div className="mt-0.5 text-[11px] text-muted tabular-nums">
                  {(file.size / 1024 / 1024).toFixed(2)} MB of {MAX_MB} MB
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">No file chosen</p>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="mt-3 rounded-xl border border-line bg-panel2 px-4 py-2 text-[12px] font-bold text-ink disabled:opacity-50"
            >
              {file ? "Choose a different video" : "Choose video"}
            </button>
            <p className="mt-2 text-[10px] text-muted">
              MP4, WebM or MOV · {MAX_MB} MB max · vertical works best
            </p>
          </div>
        </div>

        {/* token address — only when it has *not* been handed over by the feed.
            With it locked there is exactly one question left on this page:
            which video. */}
        {!tokenFromUrl && (
          <div className="mt-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
              token address
            </div>
            <input
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              placeholder="paste the SPL mint address"
              spellCheck={false}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-line bg-panel2 px-3 py-3 font-mono text-[12px] outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              The mint of the coin this clip is about. If we have not indexed it yet we will pull
              its live market data automatically.
            </p>
          </div>
        )}

        {/* caption */}
        <div className="mt-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">caption</div>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={280}
            placeholder="optional"
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-line bg-panel2 px-3 py-3 text-[13px] outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        {/* progress */}
        {busy && (
          <div className="mt-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-center text-[11px] text-muted tabular-nums">
              {pct < 100 ? `uploading… ${pct}%` : "publishing…"}
            </p>
          </div>
        )}

        <button
          onClick={() => void start()}
          disabled={busy || !file}
          className="mt-5 w-full rounded-xl burn-gradient py-3.5 text-sm font-black tracking-wide text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "publishing…" : "Publish clip"}
        </button>

        <p className="mt-3 text-center text-[10px] leading-relaxed text-muted">
          Only upload video you have the rights to. We may remove any clip.
        </p>

        {message && <p className="mt-3 text-center text-[11px] font-semibold text-down">{message}</p>}

        {done && (
          <div className="mt-5 rounded-2xl border border-up/40 bg-up/5 p-4 text-center">
            <div className="text-[11px] font-bold uppercase tracking-widest text-up">Live</div>
            <p className="mt-1 text-sm font-bold">
              Your clip is now in the feed for ${sym(done.symbol)}
            </p>
            <Link
              href={`/coin/${done.symbol}`}
              className="mt-3 inline-block rounded-xl border border-line bg-panel2 px-4 py-2 text-[12px] font-bold text-ink"
            >
              Open ${sym(done.symbol)}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

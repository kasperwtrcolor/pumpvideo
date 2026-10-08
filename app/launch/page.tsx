"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Keypair, VersionedTransaction, Connection } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useTrader } from "@/components/TraderProvider";
import { useIsDesktop } from "@/lib/use-desktop";
import { publicSolanaRpc } from "@/lib/capabilities";
import { Mascot } from "@/components/Mascots";
import { ChevronRightIcon, ImageIcon, RocketIcon } from "@/components/Icons";
import { CoinAvatar } from "@/components/CoinAvatar";
import { sym } from "@/lib/format";

const MAX_MB = 25;
const MAX_BYTES = MAX_MB * 1024 * 1024;
/** Mint rent + transaction fee + a little headroom. */
const EST_LAUNCH_SOL = 0.022;

type MediaKind = "video" | "image";
type PoolPair = "SOL" | "USDC" | "CUSTOM";
type RewardTo = "CREATOR" | "HOLDERS";
type Phase = "idle" | "preparing" | "signing" | "confirming";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PUT a file to a signed URL, reporting progress. fetch() cannot do this. */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload rejected by storage (${xhr.status})`));
    xhr.onerror = () => reject(new Error("upload failed — check your connection"));
    xhr.send(file);
  });
}

/**
 * Pull one frame out of a video, in the browser.
 *
 * This is the only reason a video launch can have a still image at all: a coin's
 * on-chain metadata needs an `image`, and there is no ffmpeg in a serverless
 * function. A `<video>` element playing a frame to a canvas does the job with
 * nothing to install. The frame is taken just after the start rather than at
 * exactly 0, because many clips open on a black frame.
 */
async function extractThumbnail(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("could not read that video")), 12_000);
      video.onloadeddata = () => {
        clearTimeout(to);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(to);
        reject(new Error("could not read that video"));
      };
    });

    const seekTo = Math.min(0.1, (video.duration || 1) / 2);
    if (Number.isFinite(seekTo) && seekTo > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = seekTo;
        setTimeout(resolve, 2000);
      });
    }

    const w = video.videoWidth || 512;
    const h = video.videoHeight || 512;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("your browser blocked the thumbnail step");
    ctx.drawImage(video, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("could not build a thumbnail from that video");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Step 1: sign one object, PUT the bytes, return its object path. */
async function uploadOne(
  auth: Record<string, string>,
  file: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const pre = await fetch("/api/launch/presign", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ contentType, sizeBytes: file.size }),
  });
  if (!pre.ok) {
    const j = await pre.json().catch(() => ({}));
    throw new Error(j.detail || j.error || "could not start the upload");
  }
  const { object, uploadUrl, headers } = (await pre.json()) as {
    object: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  await putWithProgress(uploadUrl, headers, file, onProgress);
  return object;
}

export default function LaunchPage() {
  const { toast } = useTrader();
  const { login, authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const desktop = useIsDesktop();

  const wallet = wallets[0] ?? null;

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<MediaKind | null>(null);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");

  const [poolPair, setPoolPair] = useState<PoolPair>("SOL");
  const [customMint, setCustomMint] = useState("");
  const [rewardTo, setRewardTo] = useState<RewardTo>("CREATOR");

  const [showSocials, setShowSocials] = useState(false);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");

  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ mint: string; symbol: string; hasVideo: boolean } | null>(null);

  // Object URLs are a leak if not revoked; one preview at a time.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pick = useCallback(
    (f: File | null) => {
      setMessage(null);
      setDone(null);
      if (!f) return;
      const isVideo = f.type.startsWith("video/");
      const isImage = f.type.startsWith("image/");
      if (!isVideo && !isImage) {
        toast("that is not an image or a video", "bad");
        return;
      }
      if (f.size > MAX_BYTES) {
        toast(`files must be ${MAX_MB} MB or smaller`, "bad");
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setKind(isVideo ? "video" : "image");
    },
    [preview, toast],
  );

  const canLaunch = Boolean(file && name.trim() && symbol.trim() && !busy);

  const start = useCallback(async () => {
    if (!file || !kind) return;
    if (!wallet) {
      toast("Log in to launch", "bad");
      return;
    }
    if (!name.trim() || !symbol.trim()) {
      setMessage("A coin needs a name and a ticker.");
      return;
    }
    if (poolPair === "CUSTOM" && !customMint.trim()) {
      setMessage("A custom pool needs a quote mint address.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setDone(null);
    setPct(0);
    setPhase("preparing");

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("session expired — log in again");
      const auth = { authorization: `Bearer ${token}` };

      // 1. Media. A video also yields a still frame, which is what the coin's
      //    on-chain `image` field will point at.
      const mediaType = file.type;
      const mediaObject = await uploadOne(auth, file, mediaType, setPct);

      setPhase("preparing");
      setPct(0);
      const thumbBlob: Blob =
        kind === "video" ? await extractThumbnail(file) : file;
      const thumbType = kind === "video" ? "image/jpeg" : mediaType;
      const imageObject = await uploadOne(auth, thumbBlob, thumbType, setPct);

      // 2. The mint account. Generated here — the keypair only ever has to sign
      //    its own creation, and it never leaves the browser.
      const mintKeypair = Keypair.generate();

      // 3. Ask the server for the unsigned create transaction.
      const prep = await fetch("/api/launch/prepare", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim(),
          description: description.trim() || undefined,
          mint: mintKeypair.publicKey.toBase58(),
          poolPair,
          customMint: poolPair === "CUSTOM" ? customMint.trim() : undefined,
          rewardTo,
          mediaObject,
          imageObject,
          twitter: twitter.trim() || undefined,
          telegram: telegram.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      const prepJson = await prep.json();
      if (!prep.ok) throw new Error(prepJson.detail || prepJson.error || "could not build the launch");

      // 4. Sign, then send ourselves.
      //
      //    Order matters. Privy signs the *unsigned* transaction (so there is no
      //    question of it preserving a signature it did not make), then we add
      //    the throwaway mint keypair's signature locally and broadcast. Doing
      //    it the other way — partial-sign then hand the bytes to the wallet —
      //    would depend on the wallet merging rather than replacing signatures.
      setPhase("signing");
      const unsigned = VersionedTransaction.deserialize(b64ToBytes(prepJson.transaction as string));
      const signed = await signTransaction({
        transaction: unsigned.serialize(),
        wallet,
        chain: "solana:mainnet",
      });
      const finalTx = VersionedTransaction.deserialize(signed.signedTransaction);
      finalTx.sign([mintKeypair]);

      const connection = new Connection(publicSolanaRpc(), "confirmed");
      const signature = await connection.sendRawTransaction(finalTx.serialize(), {
        maxRetries: 3,
        skipPreflight: false,
      });

      // 5. Record it. The server verifies the signature on chain before the coin
      //    enters the catalogue.
      setPhase("confirming");
      const conf = await fetch("/api/launch/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          mint: mintKeypair.publicKey.toBase58(),
          signature,
          name: name.trim(),
          symbol: symbol.trim(),
          description: description.trim() || undefined,
          mediaObject,
          imageObject,
          caption: description.trim() || undefined,
          twitter: twitter.trim() || undefined,
          telegram: telegram.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      const confJson = await conf.json();
      if (!conf.ok) throw new Error(confJson.detail || confJson.error || "the coin could not be recorded");

      setDone({
        mint: confJson.mint as string,
        symbol: confJson.symbol as string,
        hasVideo: Boolean(confJson.hasVideo),
      });
      toast("your coin is live", "ok");
    } catch (e) {
      const m = (e as Error).message;
      setMessage(m);
      toast(m, "bad");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }, [
    file, kind, wallet, name, symbol, description, poolPair, customMint, rewardTo,
    twitter, telegram, website, getAccessToken, signTransaction, toast,
  ]);

  /* ----------------------------- signed out ----------------------------- */
  if (!authenticated) {
    return (
      <div className="no-scrollbar h-full overflow-y-auto">
        <div className="mx-auto max-w-md px-4 pb-24 pt-8 text-center">
          <RocketIcon className="mx-auto h-12 w-12 text-accent" />
          <h1 className="mt-3 text-2xl font-black tracking-tight">Launch a coin</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Drop a video, give it a name and a ticker, and it goes live on-chain. You pay the
            launch fee and earn the creator fee on every trade — forever.
          </p>
          <button
            onClick={() => void login()}
            className="mt-5 rounded-xl burn-gradient px-5 py-3 text-sm font-black text-black"
          >
            Log in to launch
          </button>
        </div>
      </div>
    );
  }

  const symbolOk = /^[A-Za-z0-9]{1,10}$/.test(symbol.trim());
  const previewName = name.trim() || "Coin name";
  const previewSymbol = symbol.trim() || "TICKER";

  /* ------------------------------ the form ------------------------------ */
  const form = (
    <div className="flex flex-col gap-5">
      {/* Media */}
      <div>
        <Label>Media</Label>
        <div className="mt-2">
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {preview ? (
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="relative aspect-video w-full bg-black">
                {kind === "video" ? (
                  <video src={preview} className="h-full w-full object-contain" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-full w-full object-contain" />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold">{file?.name}</div>
                  <div className="text-[10px] text-muted tabular-nums">
                    {((file?.size ?? 0) / 1024 / 1024).toFixed(2)} MB ·{" "}
                    {kind === "video" ? "video" : "image"}
                  </div>
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="shrink-0 rounded-full border border-line bg-panel2 px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                >
                  change
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-panel text-muted transition hover:border-accent/60 hover:text-ink disabled:opacity-60"
            >
              <ImageIcon className="h-8 w-8" />
              <span className="text-[13px] font-bold">Upload image or video</span>
              <span className="text-[10px]">MP4, WebM, MOV, PNG or JPG · {MAX_MB} MB max</span>
            </button>
          )}
        </div>
      </div>

      {/* Name */}
      <div>
        <Label>Name</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder="Enter coin name"
          disabled={busy}
          className="mt-2 w-full rounded-xl border border-line bg-panel2 px-3.5 py-3.5 text-[14px] outline-none focus:border-accent disabled:opacity-60"
        />
      </div>

      {/* Ticker */}
      <div>
        <Label>Ticker</Label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          maxLength={10}
          placeholder="Add a coin ticker (e.g. DOGE)"
          spellCheck={false}
          disabled={busy}
          className="mt-2 w-full rounded-xl border border-line bg-panel2 px-3.5 py-3.5 text-[14px] uppercase tracking-wide outline-none focus:border-accent disabled:opacity-60"
        />
        {symbol.trim() && !symbolOk && (
          <p className="mt-1.5 text-[10px] text-down">Letters and numbers only, up to 10.</p>
        )}
      </div>

      {/* Description */}
      <div>
        <Label>
          Description <span className="ml-1 normal-case tracking-normal text-muted/70">Optional</span>
        </Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Enter coin description"
          disabled={busy}
          className="mt-2 w-full resize-none rounded-xl border border-line bg-panel2 px-3.5 py-3.5 text-[14px] outline-none focus:border-accent disabled:opacity-60"
        />
      </div>

      {/* Pool pair */}
      <div>
        <Label>Pool pair</Label>
        <div className="mt-2 grid grid-cols-3 gap-2.5">
          <PairButton active={poolPair === "SOL"} onClick={() => setPoolPair("SOL")} disabled={busy}>
            <PairGlyph label="◎" tone="accent" />
            <span>SOL</span>
          </PairButton>
          <PairButton active={poolPair === "USDC"} onClick={() => setPoolPair("USDC")} disabled={busy}>
            <PairGlyph label="$" tone="info" />
            <span>USDC</span>
          </PairButton>
          <PairButton active={poolPair === "CUSTOM"} onClick={() => setPoolPair("CUSTOM")} disabled={busy}>
            <PairGlyph label="≣" tone="up" />
            <span>Custom</span>
          </PairButton>
        </div>
        {poolPair === "CUSTOM" && (
          <input
            value={customMint}
            onChange={(e) => setCustomMint(e.target.value)}
            placeholder="quote mint address"
            spellCheck={false}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-line bg-panel2 px-3.5 py-3 font-mono text-[12px] outline-none focus:border-accent disabled:opacity-60"
          />
        )}
      </div>

      {/* Social links (collapsible) */}
      <div className="overflow-hidden rounded-2xl border border-line bg-panel">
        <button
          onClick={() => setShowSocials((v) => !v)}
          disabled={busy}
          className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel2 text-muted">
            <ImageIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">Social links</span>
            <span className="block text-[10px] text-muted">Optional</span>
          </span>
          <ChevronRightIcon
            className={`h-4 w-4 text-muted transition-transform ${showSocials ? "rotate-90" : ""}`}
          />
        </button>
        {showSocials && (
          <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3.5">
            <SocialInput placeholder="Twitter / X URL" value={twitter} onChange={setTwitter} disabled={busy} />
            <SocialInput placeholder="Telegram URL" value={telegram} onChange={setTelegram} disabled={busy} />
            <SocialInput placeholder="Website URL" value={website} onChange={setWebsite} disabled={busy} />
          </div>
        )}
      </div>

      {/* Reward routing */}
      <div>
        <Label>Send creator rewards to:</Label>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-panel p-1">
          <SegmentButton active={rewardTo === "CREATOR"} onClick={() => setRewardTo("CREATOR")} disabled={busy}>
            <span aria-hidden>☕</span> Creator
          </SegmentButton>
          <SegmentButton active={rewardTo === "HOLDERS"} onClick={() => setRewardTo("HOLDERS")} disabled={busy}>
            <span aria-hidden>👥</span> Holders
          </SegmentButton>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {rewardTo === "CREATOR"
            ? "Creator fees from pump.fun route to your wallet — the one you launch with."
            : "Creator fees are shared with the coin's holders instead of you. Permanent once set."}
        </p>
      </div>

      {/* Progress */}
      {busy && (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${phase === "idle" ? pct : Math.min(pct, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-muted tabular-nums">
            {phase === "preparing" && (pct < 100 ? `uploading… ${pct}%` : "preparing the launch…")}
            {phase === "signing" && "confirm in your wallet…"}
            {phase === "confirming" && "publishing…"}
          </p>
        </div>
      )}

      <button
        onClick={() => void start()}
        disabled={!canLaunch || !symbolOk}
        className="w-full rounded-xl burn-gradient py-4 text-[15px] font-black tracking-wide text-black disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Launching…" : "Launch coin"}
      </button>

      <p className="text-center text-[10px] leading-relaxed text-muted">
        {wallet ? (
          <>
            The launch costs ~{EST_LAUNCH_SOL} SOL, paid from your wallet{" "}
            <span className="font-mono">{`${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`}</span>.
          </>
        ) : (
          "A wallet is required to pay the launch fee."
        )}
        <br />
        Coin data cannot be changed after creation.
      </p>

      {message && <p className="text-center text-[11px] font-semibold text-down">{message}</p>}
    </div>
  );

  const previewCard = (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Preview</div>
      <div className="mt-3 flex items-center gap-3">
        <CoinAvatar src={preview} symbol={previewSymbol} className="h-[52px] w-[52px] rounded-xl" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-black">{previewName}</div>
          <div className="text-[12px] text-muted">${sym(previewSymbol)}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] text-muted">
        <Row k="Pool pair" v={poolPair === "CUSTOM" ? "Custom" : poolPair} />
        <Row k="Rewards" v={rewardTo === "CREATOR" ? "Creator" : "Holders"} />
        <Row k="Launch cost" v={`~${EST_LAUNCH_SOL} SOL`} />
      </div>
      {done && (
        <div className="mt-3 rounded-xl border border-up/40 bg-up/5 p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-up">Live</div>
          <p className="mt-1 text-[12px] font-bold">${sym(done.symbol)} is on-chain</p>
          <Link
            href={`/t/${done.mint}`}
            className="mt-2 inline-block rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[11px] font-bold"
          >
            Open coin
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className={desktop ? "mx-auto max-w-3xl px-4 pb-16 pt-6" : "mx-auto max-w-md px-4 pb-24 pt-4"}>
        <div className="flex items-center gap-2">
          <RocketIcon className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-black tracking-tight">Launch a coin</h1>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Your video becomes the coin. It goes live on pump.fun&apos;s rails, and you earn the creator fee.
        </p>

        {desktop ? (
          <div className="mt-5 grid grid-cols-[1fr_320px] gap-6">
            {form}
            <div className="sticky top-6 self-start">
              {previewCard}
              {done && (
                <div className="mt-4 flex flex-col items-center rounded-2xl border border-up/40 bg-up/5 p-4 text-center">
                  <Mascot name="pepe" size={72} />
                  <p className="mt-2 text-sm font-bold">${sym(done.symbol)} just launched</p>
                  <Link
                    href={`/t/${done.mint}`}
                    className="mt-3 rounded-xl border border-line bg-panel2 px-4 py-2 text-[12px] font-bold"
                  >
                    Open the coin
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5">{form}</div>
            {done && (
              <div className="mt-5 flex flex-col items-center rounded-2xl border border-up/40 bg-up/5 p-4 text-center">
                <Mascot name="pepe" size={72} />
                <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-up">Live</div>
                <p className="mt-1 text-sm font-bold">${sym(done.symbol)} just launched</p>
                <Link
                  href={`/t/${done.mint}`}
                  className="mt-3 rounded-xl border border-line bg-panel2 px-4 py-2 text-[12px] font-bold"
                >
                  Open the coin
                </Link>
              </div>
            )}
          </>
        )}

        {!desktop && !done && <div className="mt-6 opacity-60">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Preview</div>
          <div className="mt-2 flex items-center gap-3 rounded-2xl border border-line bg-panel p-3">
            <CoinAvatar src={preview} symbol={previewSymbol} className="h-11 w-11 rounded-xl" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-black">{previewName}</div>
              <div className="text-[11px] text-muted">${sym(previewSymbol)}</div>
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}

/* ------------------------------- primitives ------------------------------- */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-ink">{children}</div>
  );
}

function PairButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3.5 text-[13px] font-bold transition disabled:opacity-60 ${
        active ? "border-accent/70 bg-accent/10 text-ink" : "border-line bg-panel text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PairGlyph({ label, tone }: { label: string; tone: "accent" | "info" | "up" }) {
  const bg =
    tone === "accent"
      ? "bg-accent/20 text-accent"
      : tone === "info"
        ? "bg-[#2775ca]/25 text-[#5aa0f2]"
        : "bg-up/20 text-up";
  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${bg}`}>
      {label}
    </span>
  );
}

function SegmentButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold transition disabled:opacity-60 ${
        active ? "bg-panel2 text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SocialInput({
  placeholder,
  value,
  onChange,
  disabled,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      disabled={disabled}
      className="w-full rounded-xl border border-line bg-panel2 px-3.5 py-3 text-[13px] outline-none focus:border-accent disabled:opacity-60"
    />
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{k}</span>
      <span className="font-bold text-ink">{v}</span>
    </div>
  );
}

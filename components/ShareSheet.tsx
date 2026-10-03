"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTrader } from "./TraderProvider";
import { useAuth } from "./AuthBridge";
import { CheckIcon, ShareIcon } from "./Icons";

/**
 * The share sheet.
 *
 * Why not just `navigator.share`: it is a one-way door. On a phone it hands the
 * whole interaction to the OS, so the app cannot offer *its own* destinations
 * (X, Telegram, WhatsApp, Reddit), cannot show where the link goes, and cannot
 * record a share the way the rail's counter promises. Desktop browsers mostly
 * lack it entirely, which used to degrade to "copy link" with no explanation.
 *
 * So this is the arrangement every clip app uses: a row of destinations you can
 * hit with one thumb, then the quieter list actions below it (copy the link,
 * save the video). The native sheet is still offered — as "More…" — because on
 * iOS it is genuinely the best path into an installed app, but it is now a
 * choice rather than the only path.
 *
 * The link points at the token's clip wall, focused on *this* clip, so a
 * recipient lands watching it and can keep swiping the token's other clips.
 */

type Target = {
  key: string;
  label: string;
  /** Brand colour for the round tile. */
  bg: string;
  glyph: ReactNode;
  href?: (url: string, text: string) => string;
};

/**
 * Share destinations, in the order they are drawn.
 *
 * `href` builds an outbound "share intent" URL — the same web entry points the
 * native apps register for — so a share works in a browser with no SDK, no app
 * id, and no per-network integration to keep alive.
 */
const TARGETS: Target[] = [
  {
    key: "x",
    label: "X",
    bg: "#000000",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
        <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.66l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.04l12.04 15.64Z" />
      </svg>
    ),
    href: (url, text) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    key: "telegram",
    label: "Telegram",
    bg: "#229ED9",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
        <path d="M21.94 4.6 18.9 19.3c-.23 1.03-.85 1.28-1.72.8l-4.75-3.5-2.29 2.2c-.25.25-.46.46-.95.46l.34-4.83 8.8-7.95c.38-.34-.08-.53-.59-.19L6.9 12.99l-4.67-1.46c-1.02-.32-1.04-1.02.21-1.5L20.64 3.1c.85-.31 1.6.2 1.3 1.5Z" />
      </svg>
    ),
    href: (url, text) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    bg: "#25D366",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
        <path d="M12.04 2.2A9.8 9.8 0 0 0 2.24 12c0 1.73.46 3.42 1.32 4.9L2.2 21.8l5.03-1.31a9.8 9.8 0 0 0 4.81 1.24h.01a9.8 9.8 0 0 0 9.8-9.8 9.8 9.8 0 0 0-9.81-9.73Zm0 17.87h-.01a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.06.8.82-2.98-.19-.31a8.09 8.09 0 0 1-1.24-4.32 8.13 8.13 0 1 1 8.11 8.12Zm4.47-6.08c-.24-.12-1.45-.72-1.67-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.53.06-.24-.12-1.03-.38-1.96-1.21-.72-.64-1.21-1.44-1.35-1.68-.14-.25-.02-.38.1-.5.11-.11.25-.29.36-.44.12-.14.16-.25.24-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.33-.75-1.82-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.02 0 1.19.87 2.34 1 2.5.12.16 1.72 2.62 4.16 3.68.58.25 1.04.4 1.4.51.59.19 1.13.16 1.55.1.47-.07 1.45-.6 1.66-1.17.2-.58.2-1.07.15-1.17-.06-.11-.22-.17-.46-.29Z" />
      </svg>
    ),
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    key: "reddit",
    label: "Reddit",
    bg: "#FF4500",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
        <path d="M22 11.5a2.1 2.1 0 0 0-3.55-1.5 10.3 10.3 0 0 0-5.4-1.7l.92-4.32 3.01.64a1.5 1.5 0 1 0 .15-.98l-3.36-.71a.5.5 0 0 0-.6.39l-1.02 4.98a10.3 10.3 0 0 0-5.46 1.7A2.1 2.1 0 1 0 3.5 13.6a4.2 4.2 0 0 0-.05.65c0 3.33 3.83 6.03 8.55 6.03s8.55-2.7 8.55-6.03a4.2 4.2 0 0 0-.04-.65A2.1 2.1 0 0 0 22 11.5ZM8.1 13.9a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5Zm7.79 3.4a5.9 5.9 0 0 1-3.89 1.2 5.9 5.9 0 0 1-3.89-1.2.4.4 0 0 1 .56-.57 5.2 5.2 0 0 0 3.33.97 5.2 5.2 0 0 0 3.33-.97.4.4 0 1 1 .56.57Zm-.5-3.4a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5Z" />
      </svg>
    ),
    href: (url, text) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
];

export function ShareSheet({
  clipId,
  mint,
  symbol,
  caption,
  videoUrl,
  open,
  onClose,
  onCount,
}: {
  clipId: string;
  mint: string;
  symbol: string;
  caption?: string | null;
  videoUrl?: string | null;
  open: boolean;
  onClose: () => void;
  onCount?: (n: number) => void;
}) {
  const { toast } = useTrader();
  const { authenticated, getToken } = useAuth();
  const [copied, setCopied] = useState(false);

  // The permalink: the token's clip wall, opened on this clip. Computed on the
  // client because `window` does not exist during the server render — and the
  // sheet is only ever mounted after a tap, which is already client-side.
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/t/${mint}?clip=${clipId}`
      : `/t/${mint}?clip=${clipId}`;
  const text = `$${symbol} on Pemp`;

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  /**
   * Record the share, best-effort.
   *
   * The share has already happened by the time this runs — this only moves the
   * counter. Failures are swallowed for the same reason the old inline handler
   * swallowed them: a share that went out is not undone by a lost count, and an
   * error toast over a sheet that just did its job is noise. Signed-out viewers
   * are not counted (the endpoint requires a login, so the number means people).
   */
  const report = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`/api/clips/${clipId}/share`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const j = (await r.json()) as { shares?: number };
      if (r.ok && typeof j.shares === "number") onCount?.(j.shares);
    } catch {
      /* the share already happened */
    }
  }, [authenticated, getToken, clipId, onCount]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        // Older/insecure contexts have no async clipboard. A throwaway textarea
        // is the only path that still works there.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast("link copied");
      void report();
    } catch {
      toast("could not copy the link", "bad");
    }
  }, [url, toast, report]);

  const openTarget = useCallback(
    (href: string) => {
      window.open(href, "_blank", "noopener,noreferrer");
      onClose();
      void report();
    },
    [onClose, report],
  );

  /** The native sheet, where the browser offers one. */
  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({ title: `$${symbol}`, text, url });
    } catch {
      return; // cancelled — not a share, not a count
    }
    onClose();
    void report();
  }, [symbol, text, url, onClose, report]);

  /**
   * Save the video file.
   *
   * Fetches the object and hands it to the browser as a download. Only offered
   * for clips that actually have a rendered video — an art-card clip has nothing
   * to save. A failed fetch (CORS, offline) falls back to opening the file,
   * which still lets a desktop user right-click → Save.
   */
  const saveVideo = useCallback(async () => {
    if (!videoUrl) return;
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("bad response");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${symbol}-pemp.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast("video saved");
    } catch {
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    }
  }, [videoUrl, symbol, toast]);

  const canNativeShare = typeof navigator !== "undefined" && Boolean(navigator.share);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="sheet-up relative w-full max-w-md rounded-t-3xl border-t border-line bg-panel shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />

        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-sm font-black tracking-tight">
            Share <span className="text-muted">· ${symbol}</span>
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            close
          </button>
        </div>

        {/* Destinations. A grid rather than a list, so each target is a large,
            consistent tap target — this is the row a thumb actually uses. */}
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 px-4 pb-2 pt-1">
          {TARGETS.map((t) => (
            <button
              key={t.key}
              onClick={() => t.href && openTarget(t.href(url, text))}
              className="press flex flex-col items-center gap-1.5"
            >
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: t.bg }}
              >
                {t.glyph}
              </span>
              <span className="text-[11px] font-semibold text-muted">{t.label}</span>
            </button>
          ))}
          {canNativeShare && (
            <button onClick={() => void nativeShare()} className="press flex flex-col items-center gap-1.5">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-panel2 text-ink">
                <ShareIcon className="h-6 w-6" />
              </span>
              <span className="text-[11px] font-semibold text-muted">More…</span>
            </button>
          )}
        </div>

        <div className="mt-2 border-t border-line">
          <button
            onClick={() => void copy()}
            className="press flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel2">
              {copied ? (
                <CheckIcon className="h-5 w-5 text-up" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
                  <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2" />
                </svg>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold">{copied ? "Link copied" : "Copy link"}</span>
              <span className="block truncate text-[11px] text-muted">{url}</span>
            </span>
          </button>

          {videoUrl && (
            <button
              onClick={() => void saveVideo()}
              className="press flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel2">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3.5v11" />
                  <path d="m7.5 10 4.5 4.5 4.5-4.5" />
                  <path d="M4.5 19.5h15" />
                </svg>
              </span>
              <span className="text-[13px] font-bold">Save video</span>
            </button>
          )}
        </div>

        <div className="px-4 pb-6 pt-1">
          <p className="text-center text-[10px] text-muted">
            {caption?.trim() ? `“${caption.trim()}”` : `Shared from Pemp`}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { LogoLockup } from "@/components/Logo";
import { MascotStack } from "@/components/Mascots";
import { XIcon } from "@/components/Icons";
import { X_HANDLE, X_URL } from "@/lib/social";
import { hideGate } from "@/lib/mobile-gate";

/**
 * The desktop gate — Pemp is a phone app, and this is what a desktop visitor
 * gets instead of it.
 *
 * Two situations raise this, and the copy has to work for both:
 *
 *   - A direct hit on an app route (`/coins`, `/account`, …). Raised by `Shell`
 *     as the whole viewport, with nothing behind it.
 *   - A CTA on the desktop landing ("Open the app", "Start watching"). Raised as
 *     an overlay over the landing, `dismissible`, so that visitor gets their
 *     marketing page back instead of being stranded.
 *
 * The payload is a QR code. The visitor is already holding the device this app
 * needs — the job is just to move the URL onto it, which a scan does in one
 * motion where "email yourself a link" does in four. The same instructions are
 * printed underneath for anyone who would rather type it, and the Add-to-Home
 * steps are the install pitch, asked for at the moment it actually makes sense.
 */
export function DesktopGate({ dismissible = false }: { dismissible?: boolean }) {
  // Read at runtime rather than baked: the same build serves pemp.fun and the
  // Vercel preview, and the QR has to point at whichever one the visitor opened.
  const [origin, setOrigin] = useState("https://www.pemp.fun");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const shown = origin.replace(/^https?:\/\//, "");

  return (
    // `landing-deck` carries the opaque gradient — without it this screen is a
    // transparent sheet over the landing it is meant to replace.
    <div className="landing landing-deck fixed inset-0 z-[110] flex flex-col overflow-y-auto text-ink">
      <div className="landing-grid" aria-hidden />

      <div className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-line/40 bg-black/20 px-5 backdrop-blur">
        <LogoLockup size={22} />
        {dismissible ? (
          <button
            onClick={hideGate}
            aria-label="Back to the landing page"
            className="press flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel text-muted hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : (
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow ${X_HANDLE} on X`}
            className="press flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel text-muted hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="relative z-10 flex flex-1 items-center px-6 py-12 lg:px-16">
        <div className="mx-auto grid w-full max-w-[1060px] grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          {/* the ask */}
          <div>
            <span className="deck-label">Pemp.fun — on your phone</span>
            <h1 className="mt-5 text-[clamp(32px,4.6vw,60px)] font-black leading-[0.95] tracking-[-0.03em]">
              This one lives in <span className="text-sheen">your pocket</span>.
            </h1>
            <p className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-muted">
              Pemp is a vertical feed you drive with your thumb — the swiping, the filming and the
              buying all happen on a phone. Open it on yours and it works the way it was built.
            </p>

            <div className="mt-7 flex items-center gap-3 rounded-2xl border border-line bg-panel/60 p-4">
              <MascotStack size={26} />
              <p className="text-[14px] leading-snug text-muted">
                <span className="font-bold text-ink">Already on this computer?</span> Scan the code,
                or just open{" "}
                <span className="font-bold text-ink">pemp.fun</span> on your phone.
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
              <Link href="/legal/terms" className="hover:text-ink">
                Terms
              </Link>
              <Link href="/legal/privacy" className="hover:text-ink">
                Privacy
              </Link>
              <a
                href={X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-ink"
              >
                <XIcon className="h-3.5 w-3.5" /> {X_HANDLE}
              </a>
            </div>
          </div>

          {/* the handoff */}
          <div className="flex flex-col gap-4">
            <div className="rounded-3xl border border-line bg-panel p-6">
              <div className="flex items-start gap-5">
                <div className="shrink-0 rounded-2xl bg-white p-3">
                  <QRCodeSVG value={origin} size={132} level="M" marginSize={0} fgColor="#08080A" />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-black">Scan with your camera</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    Point your phone at the code — it opens Pemp on the mobile it was made for.
                  </p>
                  <div className="mt-3 truncate rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] font-bold tabular-nums text-muted">
                    {shown}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Step
                title="iPhone"
                lines={["Open pemp.fun in Safari", "Tap the Share button", "Add to Home Screen"]}
              />
              <Step
                title="Android"
                lines={["Open pemp.fun in Chrome", "Tap the ⋮ menu", "Install app"]}
              />
            </div>

            <p className="px-1 text-[12px] leading-relaxed text-muted">
              Adding it to your home screen gives you the full-screen app — no browser bars, and it
              opens straight into the feed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One platform's Add-to-Home-Screen recipe, numbered so it reads as steps. */
function Step({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/60 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      <ol className="mt-3 space-y-2.5">
        {lines.map((l, i) => (
          <li key={l} className="flex items-start gap-2.5 text-[13px] leading-snug">
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-black text-accent">
              {i + 1}
            </span>
            <span className="text-muted">{l}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className={className}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

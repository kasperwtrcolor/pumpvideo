"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTrader } from "./TraderProvider";
import { NotifyBell } from "./NotifyBell";
import { SearchIcon } from "./Icons";
import { LogoLockup } from "./Logo";
import { fmtSol } from "@/lib/format";

/**
 * Slim app header: brand on the left, live wallet balance on the right.
 *
 * Navigation moved to the bottom bar, so there are no tabs or account button up
 * here any more — this is just identity and at-a-glance balance.
 *
 * Two modes, because the feed is the one screen that wants a full-bleed video:
 *
 *   on /      `absolute` — takes no layout space, background is a top-down
 *             scrim so the clip runs to the very top of the screen and the
 *             brand stays legible over whatever frame is playing. This is the
 *             TikTok arrangement.
 *   elsewhere `relative` — normal flow with a solid surface, so a list page
 *             doesn't slide under the chrome when it scrolls.
 *
 * Both keep `pt-[env(safe-area-inset-top)]` so the brand clears the notch.
 */
export function AppHeader() {
  const { trader, refresh } = useTrader();
  const [walletSol, setWalletSol] = useState<number | null>(null);
  const path = usePathname();
  const overlay = path === "/";

  // The nav shows the real wallet balance. It is read from chain (through our
  // rate-limited proxy) rather than tracked locally, so it stays honest after a
  // fill, a withdrawal, or a transfer made outside the app.
  const addr = trader?.walletAddress ?? null;
  useEffect(() => {
    if (!addr) {
      setWalletSol(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetch(`/api/wallet/balance?address=${encodeURIComponent(addr)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled && Number.isFinite(j.sol)) setWalletSol(j.sol);
        })
        .catch(() => {});
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [addr, refresh]);

  return (
    <header
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-50 flex items-center gap-2 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pt-[env(safe-area-inset-top)] pb-6"
          : "relative z-50 flex shrink-0 items-center gap-2 border-b border-line bg-bg px-3 pt-[env(safe-area-inset-top)] pb-2"
      }
    >
      <Link href="/" className="shrink-0 py-1" aria-label="PumpClip — feed">
        <LogoLockup />
      </Link>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {addr && (
          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              overlay ? "border-white/25 bg-black/35 backdrop-blur" : "border-line bg-panel2"
            }`}
            title="Your wallet balance, read live from Solana"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent pulse-dot" />
            <span className="whitespace-nowrap text-[11px] font-bold tabular-nums">
              {walletSol == null ? "—" : fmtSol(walletSol)}
              <span className="hidden sm:inline"> SOL</span>
            </span>
          </div>
        )}

        <Link
          href="/search"
          aria-label="Search people and tokens"
          className={`press flex h-8 w-8 items-center justify-center rounded-full border ${
            overlay ? "border-white/25 bg-black/35 backdrop-blur" : "border-line bg-panel2"
          }`}
        >
          <SearchIcon className="h-4 w-4" />
        </Link>

        <NotifyBell overlay={overlay} />
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTrader } from "./TraderProvider";
import { AccountButton } from "./AccountButton";
import { LogoLockup } from "./Logo";
import { fmtSol } from "@/lib/format";

const TABS = [
  { href: "/", label: "Feed" },
  { href: "/coins", label: "Coins" },
  { href: "/upload", label: "Upload" },
  { href: "/portfolio", label: "Portfolio" },
];

export function TopNav() {
  const path = usePathname();
  const { trader, refresh } = useTrader();
  const [walletSol, setWalletSol] = useState<number | null>(null);

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
    <header className="z-50 flex shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-2.5 py-2 backdrop-blur">
      <Link href="/" className="shrink-0">
        <LogoLockup />
      </Link>

      <nav className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                active
                  ? "bg-panel2 text-ink"
                  : "text-muted hover:bg-panel2/60 hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {addr && (
          <div
            className="flex items-center gap-1.5 rounded-full border border-line bg-panel2 px-2 py-1"
            title="Your wallet balance, read live from Solana"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent pulse-dot" />
            <span className="whitespace-nowrap text-[11px] font-bold tabular-nums">
              {walletSol == null ? "—" : fmtSol(walletSol)}
              <span className="hidden sm:inline"> SOL</span>
            </span>
          </div>
        )}
        <AccountButton />
      </div>
    </header>
  );
}

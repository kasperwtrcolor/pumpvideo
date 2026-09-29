"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrader } from "./TraderProvider";
import { AccountButton } from "./AccountButton";
import { fmtSol } from "@/lib/format";

const TABS = [
  { href: "/", label: "Feed" },
  { href: "/coins", label: "Coins" },
  { href: "/portfolio", label: "Portfolio" },
];

export function TopNav() {
  const path = usePathname();
  const { trader } = useTrader();
  const bal = trader?.practiceBalance ?? null;

  return (
    <header className="z-50 flex shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-2.5 py-2 backdrop-blur">
      <Link href="/" className="flex shrink-0 items-center gap-1.5">
        <span className="text-base leading-none">🔥</span>
        <span className="text-[13px] font-black tracking-[0.14em]">PUMPCLIP</span>
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
        <div
          className="flex items-center gap-1.5 rounded-full border border-line bg-panel2 px-2 py-1"
          title="Practice balance — play money. No wallet required."
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent pulse-dot" />
          {/* the word "practice" and the unit are dropped on narrow screens so the
              nav never collides with the wallet button at phone width */}
          <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted sm:inline">
            practice
          </span>
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums">
            {bal == null ? "—" : fmtSol(bal)}
            <span className="hidden sm:inline"> SOL</span>
          </span>
        </div>
        <AccountButton />
      </div>
    </header>
  );
}

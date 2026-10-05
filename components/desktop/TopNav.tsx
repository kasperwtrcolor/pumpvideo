"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrader } from "../TraderProvider";
import { NotifyBell } from "../NotifyBell";
import { DepositButton } from "../DepositButton";
import { SearchIcon } from "../Icons";
import { LogoLockup } from "../Logo";
import { fmtUsd } from "@/lib/format";

/**
 * The desktop top bar: brand and sections on the left, the room's pulse in the
 * middle, and the account corner on the right — the same arrangement as the app
 * header, laid out wide. It replaces the bottom tab bar entirely on desktop,
 * which is why the five phone destinations are all reachable from here.
 */
const LINKS = [
  { href: "/", label: "Feed", match: (p: string) => p === "/" },
  { href: "/coins", label: "Coins", match: (p: string) => p.startsWith("/coins") },
  { href: "/coins?sort=top", label: "Top", match: (p: string) => p.startsWith("/coins") && p.includes("top") },
] as const;

export function TopNav() {
  const path = usePathname();
  const { solUsd } = useTrader();

  return (
    <header className="z-50 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg px-4">
      <Link href="/" className="shrink-0" aria-label="Pemp — feed">
        <LogoLockup size={22} />
      </Link>

      <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
        {LINKS.map((l) => {
          const active = l.label === "Top" ? false : l.match(path);
          return (
            <Link
              key={l.label}
              href={l.href}
              className={`rounded-full px-3 py-1.5 text-[13px] font-bold transition ${
                active ? "bg-panel2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* Search sits dead-centre, the way the wide feed's do — it is the one
          destination reachable from every state of the page. */}
      <Link
        href="/search"
        className="mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-full border border-line bg-panel px-3.5 text-[13px] text-muted transition hover:border-muted/50 hover:text-ink"
      >
        <SearchIcon className="h-4 w-4" />
        Search coins, clips and people
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        <span
          title="SOL/USD"
          className="hidden rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] font-bold tabular-nums text-muted xl:inline-block"
        >
          SOL {fmtUsd(solUsd)}
        </span>

        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] font-black tracking-wide text-up xl:inline-flex">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-up" />
          LIVE
        </span>

        <Link
          href="/upload"
          className="press rounded-full border border-line bg-panel px-3.5 py-2 text-[13px] font-bold text-ink hover:bg-panel2"
        >
          + Post
        </Link>

        <DepositButton overlay={false} />
        <NotifyBell overlay={false} />
      </div>
    </header>
  );
}

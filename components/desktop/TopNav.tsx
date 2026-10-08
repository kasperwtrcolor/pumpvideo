"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrader } from "../TraderProvider";
import type { Trader } from "../TraderProvider";
import { NotifyBell } from "../NotifyBell";
import { DepositButton } from "../DepositButton";
import { PersonIcon, SearchIcon } from "../Icons";
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
  { href: "/top", label: "Top", match: (p: string) => p.startsWith("/top") },
  { href: "/launch", label: "Launch", match: (p: string) => p.startsWith("/launch") },
] as const;

export function TopNav() {
  const path = usePathname();
  const { trader, solUsd } = useTrader();

  return (
    <header className="z-50 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg px-4">
      <Link href="/" className="shrink-0" aria-label="Pemp — feed">
        <LogoLockup size={22} />
      </Link>

      <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
        {LINKS.map((l) => {
          const active = l.match(path);
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

        {/* Your account. The phone header has had this all along — avatar on the
            left, tap to manage the wallet — and the wide bar had no way into
            /account at all, which is why it read as missing. The avatar is the
            affordance every wallet app uses, so it lives in the same corner
            here: rightmost, past the money button. */}
        <Link
          href="/account"
          aria-label="Your account"
          title="Your account"
          className={`press flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[13px] font-black ${
            path.startsWith("/account")
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-line bg-panel2 text-ink hover:border-muted/50"
          }`}
        >
          <AccountGlyph trader={trader} />
        </Link>
      </div>
    </header>
  );
}

/** Avatar when the trader has one; otherwise the first letter of their name. */
function AccountGlyph({ trader }: { trader: Trader | null }) {
  if (trader?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trader.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
    );
  }
  const initial = (trader?.username ?? trader?.displayName ?? "").slice(0, 1).toUpperCase();
  return initial ? <span>{initial}</span> : <PersonIcon className="h-4 w-4" />;
}

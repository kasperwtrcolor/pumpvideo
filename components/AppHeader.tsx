"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrader } from "./TraderProvider";
import type { AccountSummary, Trader } from "./TraderProvider";
import { NotifyBell } from "./NotifyBell";
import { DepositButton } from "./DepositButton";
import { SearchIcon, RocketIcon } from "./Icons";
import { LogoLockup } from "./Logo";
import { fmtPctAbs, fmtUsd } from "@/lib/format";

/**
 * The app header: who you are on the left, money on the right.
 *
 * Modelled on the wallet-app arrangement — avatar, balance, and a Deposit
 * button in the corner — because that is what this screen is actually for once
 * you are signed in. Signed out there is no account to show, so the brand takes
 * the avatar's place and the corner button reads "Login".
 *
 * The balance is the *portfolio*, not just the wallet: cash plus the mark value
 * of what you hold, in USD, with unrealised PnL underneath coloured up or down.
 * It comes from the same /api/account poll that already keeps the trader fresh,
 * so showing it here costs no extra request.
 *
 * Two modes, because the feed is the one screen that wants a full-bleed video:
 *
 *   on /      `absolute` — takes no layout space, background is a top-down
 *             scrim so the clip runs to the very top of the screen and the
 *             chrome stays legible over whatever frame is playing.
 *   elsewhere `relative` — normal flow with a solid surface, so a list page
 *             doesn't slide under the chrome when it scrolls.
 *
 * Both keep `pt-[env(safe-area-inset-top)]` so the header clears the notch.
 */
export function AppHeader() {
  const { trader, account, solUsd } = useTrader();
  const path = usePathname();
  const overlay = path === "/";
  const signedIn = Boolean(trader?.loggedIn);

  return (
    <header
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-50 flex items-center gap-2.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-3 pt-[env(safe-area-inset-top)] pb-7"
          : "relative z-50 flex shrink-0 items-center gap-2.5 border-b border-line bg-bg px-3 pt-[env(safe-area-inset-top)] pb-2"
      }
    >
      {signedIn ? (
        <Link href="/account" className="flex min-w-0 items-center gap-2.5" aria-label="Your account">
          <Avatar trader={trader} />
          <BalanceBlock account={account} solUsd={solUsd} />
        </Link>
      ) : (
        <Link href="/" className="shrink-0 py-1" aria-label="Pemp — feed">
          <LogoLockup size={24} />
        </Link>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DepositButton overlay={overlay} />
        {/* Launch sits here on the phone because it is the one action that
            creates rather than consumes — the bottom bar's five slots are all
            browsing destinations, and a launch is not a tab you live in. */}
        <Link
          href="/launch"
          aria-label="Launch a coin"
          className="press flex h-9 w-9 items-center justify-center rounded-full border border-accent/50 bg-accent/15 text-accent backdrop-blur"
        >
          <RocketIcon className="h-4 w-4" />
        </Link>
        <Link
          href="/search"
          aria-label="Search people and tokens"
          className={`press flex h-9 w-9 items-center justify-center rounded-full border ${
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

/** Avatar when the trader has one; otherwise the first letter of their name. */
function Avatar({ trader }: { trader: Trader | null }) {
  const initial = (trader?.username ?? trader?.displayName ?? "?").slice(0, 1).toUpperCase();
  if (trader?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trader.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/25"
      />
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel2 text-[16px] font-black ring-2 ring-white/20">
      {initial}
    </span>
  );
}

/** Portfolio headline: cash + holdings in USD, with unrealised PnL beneath it. */
function BalanceBlock({
  account,
  solUsd,
}: {
  account: AccountSummary | null;
  solUsd: number;
}) {
  const totalSol = (account?.walletSol ?? 0) + (account?.holdingsValue ?? 0);
  const pnlSol = account?.pnlSol ?? 0;
  const pnlPct = account?.pnlPct ?? 0;
  const up = pnlSol >= 0;
  const known = account != null;

  return (
    <div className="min-w-0">
      <div className="truncate text-[23px] font-black leading-none tracking-tight tabular-nums text-glow">
        {known ? fmtUsd(totalSol * solUsd) : "—"}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={`text-[12px] font-bold leading-none tabular-nums ${
            up ? "text-up" : "text-down"
          }`}
        >
          {up ? "+" : "−"}
          {fmtUsd(Math.abs(pnlSol) * solUsd)}
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-black leading-none tabular-nums ${
            up ? "bg-up/20 text-up" : "bg-down/20 text-down"
          }`}
        >
          {up ? "↑" : "↓"} {fmtPctAbs(pnlPct)}
        </span>
      </div>
    </div>
  );
}

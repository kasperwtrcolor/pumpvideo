"use client";

import Link from "next/link";
import { privyEnabled } from "@/components/PrivyRoot";
import { useAuth } from "@/components/AuthBridge";
import { AccountPanel } from "@/components/AccountPanel";
import { ProfileSettings } from "@/components/ProfileSettings";
import { PositionsSection } from "@/components/PositionsSection";
import { RewardsSection } from "@/components/RewardsSection";
import { LEGAL_LINKS } from "@/lib/legal";

/**
 * The account route.
 *
 * Wallet management (balance, top up, withdraw, export key, sign out) and the
 * live book both live here, on one page. This replaces the old modal sheet and
 * the separate /portfolio tab: the nav is one button lighter and there is no
 * overlay to get clipped on a small screen.
 *
 * Split into a guard + an inner component because `usePrivy()` (used deeper in
 * AccountPanel) throws without a provider, and hooks cannot be called
 * conditionally.
 */
export default function AccountPage() {
  if (!privyEnabled) {
    return (
      <Shell>
        <h1 className="text-2xl font-black tracking-tight">Account</h1>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Log in isn&apos;t configured on this deployment, so there is no wallet to manage
          here yet. The feed is fully browsable.
        </p>
      </Shell>
    );
  }
  return <AccountInner />;
}

function AccountInner() {
  const { authenticated, login } = useAuth();

  if (!authenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-black tracking-tight">Account</h1>
        <div className="mt-4 rounded-2xl border border-line bg-panel p-5 text-center">
          <h2 className="text-base font-bold tracking-tight">Sign in to trade</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Use email, Google or X. A self-custodial Solana wallet is created for you — no
            extension, no seed phrase, no deposit required to look around.
          </p>
          <button
            onClick={() => login()}
            className="burn-gradient mt-4 w-full rounded-xl py-3 text-sm font-black tracking-wide text-black active:scale-[0.99]"
          >
            Log in
          </button>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted">
          Everything in the feed is browsable without an account. You only need one to buy,
          like, comment or upload.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-black tracking-tight">Account</h1>
      <p className="mt-1 text-xs text-muted">
        Your wallet and your live book. Keys stay with you — Pemp never holds them.
      </p>

      <div className="mt-4">
        <AccountPanel />
      </div>

      <RewardsSection />

      <div className="mt-4">
        <ProfileSettings />
      </div>

      <PositionsSection />

      <footer className="mt-10 border-t border-line pt-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.doc} href={l.href} className="text-muted underline hover:text-ink">
              {l.label}
            </Link>
          ))}
          <Link href="/coins" className="text-muted underline hover:text-ink">
            Coins
          </Link>
          <Link href="/" className="text-muted underline hover:text-ink">
            Feed
          </Link>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted">
          Tokens traded here are highly speculative and can lose all their value. Nothing in
          Pemp is investment advice. You trade from your own self-custodial wallet.
        </p>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-3 pb-24 pt-4">{children}</div>
    </div>
  );
}

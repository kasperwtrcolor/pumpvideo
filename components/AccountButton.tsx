"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { privyEnabled } from "./PrivyRoot";
import { WalletSheet } from "./WalletSheet";
import { useTrader } from "./TraderProvider";
import { shortAddr } from "@/lib/format";

/**
 * Account entry point in the nav.
 *
 * Split into a guard + an inner component on purpose: `usePrivy()` throws when
 * there is no `PrivyProvider` above it, and hooks cannot be called
 * conditionally. Returning early in the outer component keeps the hook call
 * unconditional in the one that actually runs.
 */
export function AccountButton() {
  if (!privyEnabled) return null;
  return <AccountButtonInner />;
}

function AccountButtonInner() {
  const { ready, authenticated, login } = usePrivy();
  const { trader } = useTrader();
  const [open, setOpen] = useState(false);

  if (!ready) {
    return (
      <button
        disabled
        className="shrink-0 rounded-full border border-line bg-panel2 px-2.5 py-1.5 text-[11px] font-semibold text-muted opacity-60"
      >
        …
      </button>
    );
  }

  if (!authenticated) {
    return (
      <button
        onClick={() => login()}
        title="Log in with email, Google or X — a Solana wallet is created for you"
        className="shrink-0 whitespace-nowrap rounded-full burn-gradient px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:opacity-90"
      >
        Log in
      </button>
    );
  }

  const addr = trader?.walletAddress ?? null;
  const label = addr ? shortAddr(addr, 3) : "Account";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={addr ?? "Your account"}
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel2 px-2 py-1.5 text-[11px] font-semibold text-ink transition hover:border-accent"
      >
        {trader?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trader.avatarUrl}
            alt=""
            className="h-4 w-4 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-up" />
        )}
        {label}
      </button>
      <WalletSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
"use client";

import { useCallback, useState } from "react";
import { useAddFunds, usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useTrader } from "./TraderProvider";
import { privyEnabled } from "./PrivyRoot";

/** Solana mainnet genesis hash — the CAIP-2 chain id Privy's funding flow wants. */
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * The header's money button: Deposit when signed in, Login when not.
 *
 * One control rather than two, because it is the same decision from the user's
 * side — "put money in" — and the only difference is whether we already know
 * where to put it. Keeping it in the top-right corner, where every wallet app
 * puts it, means it never has to be hunted for.
 *
 * Split into a guard + an inner component because `usePrivy()` throws without a
 * provider, and hooks cannot be called conditionally.
 */
export function DepositButton({ overlay }: { overlay?: boolean }) {
  if (!privyEnabled) return null;
  return <DepositButtonInner overlay={overlay} />;
}

function DepositButtonInner({ overlay }: { overlay?: boolean }) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { addFunds } = useAddFunds();
  const { trader, toast } = useTrader();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    if (!authenticated) {
      login();
      return;
    }
    const address = wallets[0]?.address ?? trader?.walletAddress ?? null;
    if (!address) {
      toast("your wallet is still being created — try again in a moment", "bad");
      return;
    }
    setBusy(true);
    try {
      await addFunds({
        destination: { address, chain: SOLANA_MAINNET_CAIP2, asset: "native" },
        fiat: { defaultAmount: "50" },
        crypto: {},
      });
      toast("Funding started");
    } catch (e) {
      const msg = (e as Error).message || "";
      toast(
        /not enabled|unsupported|invalid/i.test(msg)
          ? "Card top-up isn't enabled on this app yet — use Receive in Account"
          : msg || "Top-up unavailable",
        "bad",
      );
    } finally {
      setBusy(false);
    }
  }, [authenticated, login, wallets, trader, addFunds, toast]);

  return (
    <button
      onClick={() => void onClick()}
      disabled={busy}
      aria-label={authenticated ? "Deposit funds" : "Login"}
      className={`press shrink-0 rounded-full bg-white px-3.5 py-2 text-[13px] font-black tracking-tight text-black disabled:opacity-60 ${
        overlay ? "shadow-[0_4px_16px_rgba(0,0,0,0.45)]" : ""
      }`}
    >
      {authenticated ? (busy ? "…" : "Deposit") : "Login"}
    </button>
  );
}

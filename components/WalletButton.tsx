"use client";

import { useCallback, useEffect, useState } from "react";
import { useTrader } from "./TraderProvider";
import { shortAddr } from "@/lib/format";

type SolanaProvider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  on?: (ev: string, cb: (...a: unknown[]) => void) => void;
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

function provider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

/**
 * Wallet connect for the LIVE path.
 *
 * Connecting links the pubkey to this anonymous trader row. It does not enable
 * live fills — those need executeLiveFill() implemented server-side. We show the
 * truth in the UI ("live fills not wired") rather than a fake success state.
 */
export function WalletButton() {
  const { trader, setTrader, toast } = useTrader();
  const [hasProvider, setHasProvider] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHasProvider(Boolean(provider()));
    const p = provider();
    if (!p?.on) return;
    p.on("connect", () => setHasProvider(true));
    p.on("disconnect", () => setHasProvider(true));
  }, []);

  const link = useCallback(
    async (address: string | null) => {
      const r = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || "link failed");
      if (trader) setTrader({ ...trader, walletAddress: j.walletAddress });
    },
    [trader, setTrader],
  );

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    setBusy(true);
    try {
      const res = await p.connect();
      await link(res.publicKey.toString());
      toast("wallet linked · live fills not wired yet", "ok");
    } catch (e) {
      toast((e as Error).message || "connect cancelled", "bad");
    } finally {
      setBusy(false);
    }
  }, [link, toast]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await provider()?.disconnect();
      await link(null);
      toast("wallet unlinked");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [link, toast]);

  const addr = trader?.walletAddress;

  return (
    <button
      onClick={addr ? disconnect : connect}
      disabled={busy}
      title={hasProvider ? undefined : "No Solana wallet detected — opens phantom.app"}
      className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${
        addr
          ? "border-line bg-panel2 text-ink hover:border-accent"
          : "border-line bg-panel2 text-muted hover:text-ink"
      } disabled:opacity-50`}
    >
      {busy ? "…" : addr ? shortAddr(addr, 3) : "Wallet"}
    </button>
  );
}

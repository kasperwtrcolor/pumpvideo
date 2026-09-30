"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Trader = {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
  /** Claimed public handle, if any. Never the session handle. */
  username: string | null;
  bio: string | null;
  avatarUrl: string | null;
  email: string | null;
  loginMethod: string | null;
  /** True once a verified Privy identity is bound to this trader. */
  loggedIn: boolean;
  /** Whether the app itself can place real on-chain trades. */
  canTrade: boolean;
};

type Toast = { id: number; text: string; tone: "ok" | "bad" };

/**
 * The money half of /api/account, kept alongside the trader so the header can
 * show a portfolio without a second request. Written by the same poll that
 * already refreshes the trader.
 */
export type AccountSummary = {
  /** Live on-chain SOL, or null when it could not be read. */
  walletSol: number | null;
  /** Value of everything held, in SOL, at the last mark. */
  holdingsValue: number;
  /** Unrealised PnL on those holdings, in SOL. */
  pnlSol: number;
  pnlPct: number;
  /** Lifetime creator rewards, in SOL. */
  rewardsSol: number;
};

type Ctx = {
  trader: Trader | null;
  setTrader: (t: Trader) => void;
  account: AccountSummary | null;
  refresh: () => Promise<void>;
  solUsd: number;
  toasts: Toast[];
  toast: (text: string, tone?: "ok" | "bad") => void;
};

const TraderCtx = createContext<Ctx | null>(null);

export function useTrader() {
  const c = useContext(TraderCtx);
  if (!c) throw new Error("useTrader must be used inside <TraderProvider>");
  return c;
}

export function TraderProvider({
  children,
  initialSolUsd,
}: {
  children: React.ReactNode;
  initialSolUsd: number;
}) {
  const [trader, setTrader] = useState<Trader | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [solUsd, setSolUsd] = useState(initialSolUsd);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      const j = await r.json();
      if (j.trader) setTrader(j.trader as Trader);
      // The same payload carries the portfolio. Publishing it here means the
      // header's balance costs nothing extra — there is already a poll running.
      if (Number.isFinite(j.holdingsValue) || Number.isFinite(j.pnlSol)) {
        setAccount({
          walletSol: Number.isFinite(j.walletSol) ? (j.walletSol as number) : null,
          holdingsValue: Number.isFinite(j.holdingsValue) ? (j.holdingsValue as number) : 0,
          pnlSol: Number.isFinite(j.pnlSol) ? (j.pnlSol as number) : 0,
          pnlPct: Number.isFinite(j.pnlPct) ? (j.pnlPct as number) : 0,
          rewardsSol: Number.isFinite(j.rewardsSol) ? (j.rewardsSol as number) : 0,
        });
      }
    } catch {
      /* offline is fine */
    }
  }, []);

  useEffect(() => {
    void refresh();
    fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT")
      .then((r) => r.json())
      .then((j) => {
        const p = Number(j?.price);
        if (Number.isFinite(p) && p > 0) setSolUsd(p);
      })
      .catch(() => {});
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(
    () => ({ trader, setTrader, account, refresh, solUsd, toasts, toast }),
    [trader, account, refresh, solUsd, toasts, toast],
  );

  return (
    <TraderCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in rounded-full px-4 py-2 text-sm font-semibold shadow-xl glass hairline border ${
              t.tone === "ok" ? "text-up" : "text-down"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </TraderCtx.Provider>
  );
}

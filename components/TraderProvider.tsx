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
  handle: string;
  walletAddress: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  loginMethod: string | null;
  /** True once a verified Privy identity is bound to this trader. */
  loggedIn: boolean;
  practiceBalance: number;
  practiceStartBal: number;
  mode: "PRACTICE" | "LIVE";
};

type Toast = { id: number; text: string; tone: "ok" | "bad" };

type Ctx = {
  trader: Trader | null;
  setTrader: (t: Trader) => void;
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
    () => ({ trader, setTrader, refresh, solUsd, toasts, toast }),
    [trader, refresh, solUsd, toasts, toast],
  );

  return (
    <TraderCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-full px-4 py-2 text-sm font-semibold shadow-xl glass hairline border ${
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

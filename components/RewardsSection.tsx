"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountResponse } from "@/lib/types";
import { useTrader } from "@/components/TraderProvider";
import { fmtSol, fmtUsd, sym } from "@/lib/format";

/**
 * Creator rewards, on the account page.
 *
 * The 1% cut a creator earns on every buy that comes through one of their
 * clips. It is paid on-chain at buy time, so this is a record of money that has
 * already landed in the wallet — never a pending balance to claim. That is the
 * whole point of showing it: "where clips pay" only means something if a
 * creator can see what they have actually been paid.
 */
export function RewardsSection() {
  const { solUsd } = useTrader();
  const [data, setData] = useState<AccountResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      if (r.ok) setData((await r.json()) as AccountResponse);
    } catch {
      /* offline — keep the last figure rather than blanking the card */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const sol = data?.rewardsSol ?? 0;
  const has = sol > 0;
  const top = data?.rewards ?? [];

  return (
    <>
      <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">Rewards</h2>
      <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Paid to you
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-3xl font-black tabular-nums text-accent">
              {data == null ? "…" : fmtSol(sol)}
            </span>
            <span className="text-sm font-bold text-muted">SOL</span>
          </div>
          <div className="text-[12px] font-semibold text-muted tabular-nums">
            {data == null ? "" : `≈ ${fmtUsd(sol * solUsd)}`}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {has ? (
              <>
                {data?.rewardsBuys} buy{data?.rewardsBuys === 1 ? "" : "s"} through{" "}
                {data?.rewardsCoins} of your clip{data?.rewardsCoins === 1 ? "" : "s"}. 1% of every
                buy through your clip is yours — settled straight to your wallet, no claim step.
              </>
            ) : (
              <>
                You earn 1% of every buy that comes through your clip. Upload one and bind it to a
                token to start earning.
              </>
            )}
          </p>
        </div>

        {top.length > 0 && (
          <div className="divide-y divide-line border-t border-line">
            {top.slice(0, 5).map((r) => (
              <div key={r.mint} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                <span className="font-bold">${sym(r.symbol)}</span>
                <span className="ml-auto font-bold tabular-nums text-accent">
                  +{fmtSol(r.sol)} SOL
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

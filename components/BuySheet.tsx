"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoinDTO } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { CoinAvatar } from "./CoinAvatar";
import { quoteBuy, quoteSell, solToLamports, uiTokensToRaw } from "@/lib/bonding-curve";
import { fmtPrice, fmtSol, fmtPct, sym } from "@/lib/format";

/**
 * The trade sheet.
 *
 * Quotes are computed client-side with the same constant-product curve the
 * server uses, so what you see before tapping is what you get after tapping —
 * the server re-quotes inside a transaction and is the source of truth.
 */
export function BuySheet({
  coin,
  open,
  onClose,
  onFilled,
}: {
  coin: CoinDTO;
  open: boolean;
  onClose: () => void;
  onFilled: (next: { priceSol: number }) => void;
}) {
  const { trader, refresh, toast } = useTrader();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [solAmount, setSolAmount] = useState(0.25);
  const [fraction, setFraction] = useState(1);
  const [held, setHeld] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Load this trader's position in the coin whenever the sheet opens.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    fetch(`/api/coins/${coin.mint}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setHeld(j?.position?.tokens ?? 0))
      .catch(() => setHeld(0));
  }, [open, coin.mint, result]);

  const vSol = BigInt(coin.virtualSol);
  const vTok = BigInt(coin.virtualToken);

  const preview = useMemo(() => {
    try {
      if (side === "BUY") {
        const f = quoteBuy(vSol, vTok, solToLamports(solAmount));
        return {
          out: Number(f.tokenAmount) / 1e6,
          fee: Number(f.feeSol) / 1e9,
          slip: f.slippagePct,
          price: f.priceSol,
        };
      }
      const raw = uiTokensToRaw(held * fraction);
      if (raw <= 0n) return null;
      const f = quoteSell(vSol, vTok, raw);
      return {
        out: Number(f.solAmount) / 1e9,
        fee: Number(f.feeSol) / 1e9,
        slip: f.slippagePct,
        price: f.priceSol,
      };
    } catch {
      return null;
    }
  }, [side, solAmount, fraction, held, vSol, vTok]);

  if (!open) return null;

  const balance = trader?.practiceBalance ?? 0;

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const body =
        side === "BUY"
          ? { mint: coin.mint, side, solAmount, mode: "PRACTICE" }
          : { mint: coin.mint, side, fraction, mode: "PRACTICE" };

      const r = await fetch("/api/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();

      if (!r.ok) throw new Error(j.detail || j.error || "trade rejected");

      const msg =
        side === "BUY"
          ? `bought ${fmtSol(j.tokensOut)} $${sym(j.symbol)} · ${solAmount} SOL in`
          : `sold ${fmtSol(j.tokensIn)} $${sym(j.symbol)} · ${fmtSol(j.solOut)} SOL out`;
      setResult(msg);
      toast(msg, "ok");
      onFilled({ priceSol: j.priceSol });
      void refresh();
      setTimeout(onClose, 550);
    } catch (e) {
      const m = (e as Error).message;
      setResult(m);
      toast(m, "bad");
    } finally {
      setBusy(false);
    }
  }

  const disabled =
    busy ||
    coin.complete ||
    (side === "BUY" ? solAmount <= 0 || solAmount > balance : held <= 0 || fraction <= 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="sheet-up relative w-full max-w-md rounded-t-3xl border-t border-line bg-panel pb-6 shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />

        {/* header */}
        <div className="flex items-center gap-3 px-4 pt-4">
          <CoinAvatar
            src={coin.imageUrl}
            symbol={coin.symbol}
            className="h-10 w-10 rounded-full border border-line"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">
              {coin.name} <span className="text-muted">${sym(coin.symbol)}</span>
            </div>
            <div className="text-[11px] text-muted tabular-nums">
              {fmtPrice(coin.priceSol)} SOL · MC {fmtSol(coin.marketCapSol)} SOL
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted">practice bal</div>
            <div className="text-sm font-bold tabular-nums">{fmtSol(balance)} SOL</div>
          </div>
        </div>

        {/* side toggle */}
        <div className="mx-4 mt-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-panel2 p-1">
          {(["BUY", "SELL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-full py-2 text-xs font-black tracking-wider transition ${
                side === s
                  ? s === "BUY"
                    ? "burn-gradient text-black"
                    : "bg-down text-black"
                  : "text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {coin.complete && (
          <p className="mx-4 mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11px] text-muted">
            This coin graduated to an AMM — curve trading is disabled.
          </p>
        )}

        {side === "BUY" ? (
          <div className="px-4 pt-4">
            <div className="grid grid-cols-4 gap-2">
              {coin.buyPresetsSol.map((p) => (
                <button
                  key={p}
                  onClick={() => setSolAmount(p)}
                  className={`rounded-xl border py-2.5 text-xs font-bold tabular-nums transition ${
                    solAmount === p
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-panel2 text-muted hover:text-ink"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3 py-2">
              <input
                type="number"
                min={0}
                step={0.01}
                value={solAmount}
                onChange={(e) => setSolAmount(Number(e.target.value))}
                className="w-full bg-transparent text-lg font-bold tabular-nums outline-none"
              />
              <span className="text-xs font-semibold text-muted">SOL</span>
            </div>
          </div>
        ) : (
          <div className="px-4 pt-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                { l: "25%", v: 0.25 },
                { l: "50%", v: 0.5 },
                { l: "75%", v: 0.75 },
                { l: "MAX", v: 1 },
              ].map((p) => (
                <button
                  key={p.l}
                  onClick={() => setFraction(p.v)}
                  className={`rounded-xl border py-2.5 text-xs font-bold transition ${
                    fraction === p.v
                      ? "border-down bg-down/15 text-down"
                      : "border-line bg-panel2 text-muted hover:text-ink"
                  }`}
                >
                  {p.l}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-panel2 px-3 py-2 text-xs">
              <span className="text-muted">you hold</span>
              <span className="font-bold tabular-nums">{fmtSol(held)} ${sym(coin.symbol)}</span>
            </div>
          </div>
        )}

        {/* quote preview */}
        <div className="mx-4 mt-4 space-y-1.5 rounded-xl border border-line bg-panel2/60 px-3 py-3 text-xs">
          <Row
            label={side === "BUY" ? "you receive" : "you receive"}
            value={
              preview
                ? side === "BUY"
                  ? `${fmtSol(preview.out)} $${sym(coin.symbol)}`
                  : `${fmtSol(preview.out)} SOL`
                : "—"
            }
          />
          <Row
            label="avg price"
            value={preview ? `${fmtPrice(preview.price)} SOL` : "—"}
          />
          <Row label="curve fee (1%)" value={preview ? `${fmtSol(preview.fee)}` : "—"} />
          <Row
            label="price impact"
            value={preview ? fmtPct(preview.slip) : "—"}
            tone={preview && preview.slip > 5 ? "bad" : undefined}
          />
        </div>

        <button
          onClick={submit}
          disabled={disabled}
          className={`mx-4 mt-4 w-[calc(100%-2rem)] rounded-xl py-3.5 text-sm font-black tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
            side === "BUY" ? "burn-gradient text-black" : "bg-down text-black"
          }`}
        >
          {busy
            ? "filling…"
            : coin.complete
              ? "curve closed"
              : side === "BUY"
                ? `buy $${sym(coin.symbol)} · ${solAmount} SOL (practice)`
                : `sell ${fraction === 1 ? "all" : `${fraction * 100}%`} $${sym(coin.symbol)}`}
        </button>

        <p className="mt-3 px-4 text-center text-[10px] leading-relaxed text-muted">
          Practice fills are priced off live on-chain reserves with the real 1% curve fee.
          No SOL moves. Live trading is not wired yet.
        </p>

        {result && (
          <p className="mt-2 px-4 text-center text-[11px] font-semibold text-muted">
            {result}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span
        className={`font-bold tabular-nums ${tone === "bad" ? "text-down" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { CoinDTO } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { CoinAvatar } from "./CoinAvatar";
import { fmtPrice, fmtSol, fmtPct, sym } from "@/lib/format";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";

/** What /api/trade/live/prepare hands back for the review step. */
type FeeReport = {
  treasurySol: number;
  creatorSol: number;
  creatorWallet: string | null;
  totalSol: number;
};

type LiveQuote = {
  transaction: string;
  side: "BUY" | "SELL";
  route: string[];
  slippageBps: number;
  priceImpactPct: number;
  expectedTokens?: number;
  minTokens?: number;
  expectedSol?: number;
  minSol?: number;
  solIn?: number;
  fees?: FeeReport;
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The trade sheet.
 *
 * There is one mode: LIVE. Every fill is a real on-chain swap, quoted by
 * Jupiter, signed by the viewer's own wallet, and verified against the chain
 * before it is recorded. Nothing is simulated and no balance is invented — if
 * there is no wallet there is no trade, which is why a logged-out viewer gets a
 * prompt instead of a button.
 *
 * A buy also carries the in-app fee: 1% to the clip's creator and 2% to the
 * treasury vault, appended to the swap as SOL transfers so they settle with it
 * or not at all. The review step shows exactly what they cost.
 */
export function BuySheet({
  coin,
  clipId,
  open,
  onClose,
  onFilled,
}: {
  coin: CoinDTO;
  /** The clip the buyer came through — decides which creator earns the 1%. */
  clipId?: string;
  open: boolean;
  onClose: () => void;
  onFilled: (next: { priceSol: number }) => void;
}) {
  const { trader, refresh, toast } = useTrader();
  const { getAccessToken, login } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [solAmount, setSolAmount] = useState(0.25);
  const [fraction, setFraction] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [liveSol, setLiveSol] = useState<number | null>(null);
  const [liveHeld, setLiveHeld] = useState<number | null>(null);

  const wallet = wallets[0] ?? null;
  const canTrade = trader?.canTrade !== false;

  // Real balances only. These are read from chain, never from a local estimate.
  useEffect(() => {
    if (!open || !wallet?.address) return;
    fetch(
      `/api/wallet/balance?address=${encodeURIComponent(wallet.address)}&mint=${encodeURIComponent(coin.mint)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (Number.isFinite(j.sol)) setLiveSol(j.sol);
        if (Number.isFinite(j.tokens)) setLiveHeld(j.tokens);
      })
      .catch(() => {});
  }, [open, wallet?.address, coin.mint, result]);

  const close = useCallback(() => {
    setLiveQuote(null);
    setResult(null);
    onClose();
  }, [onClose]);

  /** Step 1: ask the server for an unsigned swap. */
  const requestLiveQuote = useCallback(async () => {
    if (!wallet) {
      toast("Log in to trade", "bad");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("session expired — log in again");

      const body =
        side === "BUY"
          ? { mint: coin.mint, side, solAmount, clipId }
          : { mint: coin.mint, side, fraction };

      const r = await fetch("/api/trade/live/prepare", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || "could not build the swap");
      setLiveQuote(j as LiveQuote);
    } catch (e) {
      const m = (e as Error).message;
      setResult(m);
      toast(m, "bad");
    } finally {
      setBusy(false);
    }
  }, [wallet, getAccessToken, side, coin.mint, solAmount, fraction, clipId, toast]);

  /** Steps 2 and 3: sign locally, then have the server verify it on chain. */
  const signAndConfirm = useCallback(async () => {
    if (!liveQuote || !wallet) return;
    setBusy(true);
    setResult(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("session expired — log in again");

      // The private key never leaves Privy: we hand over transaction bytes and
      // get back a signature.
      const sigBytes = await signAndSendTransaction({
        transaction: b64ToBytes(liveQuote.transaction),
        wallet,
        chain: "solana:mainnet",
      });
      const signature = getBase58Decoder().decode(sigBytes.signature);

      const r = await fetch("/api/trade/live/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mint: coin.mint, side: liveQuote.side, signature, clipId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || "could not verify the trade");

      const msg =
        liveQuote.side === "BUY"
          ? `bought ${fmtSol(j.tokenAmount)} $${sym(coin.symbol)} on chain`
          : `sold $${sym(coin.symbol)} for ${fmtSol(j.solAmount)} SOL on chain`;
      setLiveQuote(null);
      setResult(msg);
      toast(msg, "ok");
      onFilled({ priceSol: j.priceSol || coin.priceSol });
      void refresh();
      setTimeout(close, 900);
    } catch (e) {
      const m = (e as Error).message || "transaction failed";
      setResult(m);
      toast(m, "bad");
    } finally {
      setBusy(false);
    }
  }, [
    liveQuote,
    wallet,
    getAccessToken,
    signAndSendTransaction,
    coin.mint,
    coin.symbol,
    coin.priceSol,
    clipId,
    onFilled,
    refresh,
    close,
    toast,
  ]);

  if (!open) return null;

  const heldForSell = liveHeld ?? 0;
  const disabled =
    busy ||
    !canTrade ||
    (side === "BUY" ? solAmount <= 0 : heldForSell <= 0 || fraction <= 0);
  const reviewing = liveQuote !== null;
  const fees = liveQuote?.fees;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={close}
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
            <div className="text-[10px] uppercase tracking-wider text-muted">wallet</div>
            <div className="text-sm font-bold tabular-nums">
              {liveSol == null ? "…" : `${fmtSol(liveSol)} SOL`}
            </div>
          </div>
        </div>

        {/* logged-out prompt */}
        {!wallet && (
          <div className="mx-4 mt-3 rounded-xl border border-line bg-panel2 p-3 text-center">
            <p className="text-[11px] text-muted">
              Trading needs a wallet. Log in and a self-custodial Solana wallet is created for you.
            </p>
            <button
              onClick={() => void login()}
              className="mt-2 rounded-xl burn-gradient px-4 py-2 text-[12px] font-black text-black"
            >
              Log in
            </button>
          </div>
        )}

        {!canTrade && (
          <p className="mx-4 mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11px] text-muted">
            Trading is disabled for this deployment.
          </p>
        )}

        {/* side toggle */}
        {!reviewing && (
          <div className="mx-4 mt-3 grid grid-cols-2 gap-1 rounded-full border border-line bg-panel2 p-1">
            {(["BUY", "SELL"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSide(s);
                  setResult(null);
                }}
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
        )}

        {/* ---------------- review step ---------------- */}
        {reviewing && liveQuote && (
          <div className="px-4 pt-4">
            <div className="rounded-xl border border-up/40 bg-up/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-up">
                Confirm on-chain trade
              </div>
              <div className="mt-2 space-y-1.5 text-xs">
                <Row
                  label={liveQuote.side === "BUY" ? "you pay" : "you sell"}
                  value={
                    liveQuote.side === "BUY"
                      ? `${fmtSol(liveQuote.solIn ?? 0)} SOL`
                      : `${fraction === 1 ? "all" : `${fraction * 100}%`} of your $${sym(coin.symbol)}`
                  }
                />
                <Row
                  label="you receive (est.)"
                  value={
                    liveQuote.side === "BUY"
                      ? `${fmtSol(liveQuote.expectedTokens ?? 0)} $${sym(coin.symbol)}`
                      : `${fmtSol(liveQuote.expectedSol ?? 0)} SOL`
                  }
                />
                <Row
                  label="minimum received"
                  value={
                    liveQuote.side === "BUY"
                      ? `${fmtSol(liveQuote.minTokens ?? 0)} $${sym(coin.symbol)}`
                      : `${fmtSol(liveQuote.minSol ?? 0)} SOL`
                  }
                />
                <Row label="price impact" value={fmtPct(liveQuote.priceImpactPct)} />
                <Row label="slippage" value={`${(liveQuote.slippageBps / 100).toFixed(1)}%`} />
                <Row label="route" value={liveQuote.route.join(" → ") || "Jupiter"} />
              </div>
            </div>

            {fees && fees.totalSol > 0 && (
              <div className="mt-3 rounded-xl border border-line bg-panel2/60 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  In-app fee · charged with the swap
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  {fees.creatorSol > 0 && (
                    <Row
                      label={`creator${fees.creatorWallet ? ` ${fees.creatorWallet.slice(0, 4)}…${fees.creatorWallet.slice(-4)}` : ""} · 1%`}
                      value={`${fmtSol(fees.creatorSol)} SOL`}
                    />
                  )}
                  <Row
                    label={`treasury${fees.creatorSol === 0 ? " (incl. creator share) · 3%" : " · 2%"}`}
                    value={`${fmtSol(fees.treasurySol)} SOL`}
                  />
                  <div className="border-t border-line pt-1.5">
                    <Row label="total fee on top" value={`${fmtSol(fees.totalSol)} SOL`} />
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => void signAndConfirm()}
              disabled={busy}
              className="mt-4 w-full rounded-xl burn-gradient py-3.5 text-sm font-black tracking-wide text-black disabled:opacity-50"
            >
              {busy ? "signing…" : "Confirm & sign"}
            </button>
            <button
              onClick={() => setLiveQuote(null)}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-line py-2.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-50"
            >
              Back
            </button>
            <p className="mt-3 text-center text-[10px] leading-relaxed text-muted">
              Your wallet signs this locally — PumpClip never sees your key. Amounts are re-read
              from the chain when the trade is recorded.
            </p>
          </div>
        )}

        {/* ---------------- amount form ---------------- */}
        {!reviewing && (
          <>
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
                {liveSol != null && solAmount > liveSol && (
                  <p className="mt-2 text-[11px] text-down">
                    Wallet holds {fmtSol(liveSol)} SOL — not enough for this trade.
                  </p>
                )}
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
                  <span className="text-muted">you hold (on-chain)</span>
                  <span className="font-bold tabular-nums">
                    {liveHeld == null ? "…" : `${fmtSol(heldForSell)} $${sym(coin.symbol)}`}
                  </span>
                </div>
              </div>
            )}

            {/* summary */}
            <div className="mx-4 mt-4 space-y-1.5 rounded-xl border border-line bg-panel2/60 px-3 py-3 text-xs">
              <Row
                label={side === "BUY" ? "you pay" : "you sell"}
                value={side === "BUY" ? `${solAmount} SOL` : `${fraction * 100}% of holding`}
              />
              <Row label="quote" value="fetched from Jupiter on next step" />
              <Row label="slippage tolerance" value="5%" />
              {side === "BUY" && <Row label="in-app fee" value="+3% (1% creator · 2% treasury)" />}
            </div>

            <button
              onClick={() => void requestLiveQuote()}
              disabled={disabled || !wallet}
              className={`mx-4 mt-4 w-[calc(100%-2rem)] rounded-xl py-3.5 text-sm font-black tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
                side === "BUY" ? "burn-gradient text-black" : "bg-down text-black"
              }`}
            >
              {busy
                ? "getting quote…"
                : side === "BUY"
                  ? `buy $${sym(coin.symbol)} · ${solAmount} SOL`
                  : `sell ${fraction === 1 ? "all" : `${fraction * 100}%`} $${sym(coin.symbol)}`}
            </button>

            <p className="mt-3 px-4 text-center text-[10px] leading-relaxed text-muted">
              Real SOL. You&apos;ll see the exact quote and sign it in your wallet before anything
              settles. Memecoins can go to zero.
            </p>
          </>
        )}

        {result && (
          <p className="mt-2 px-4 text-center text-[11px] font-semibold text-muted">{result}</p>
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
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-muted">{label}</span>
      <span
        className={`shrink-0 font-bold tabular-nums ${tone === "bad" ? "text-down" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CoinDTO } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { CoinAvatar } from "./CoinAvatar";
import { PairBadge } from "./PairBadge";
import { fmtPrice, fmtSol, fmtPct, fmtUsd, sym } from "@/lib/format";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "./AuthBridge";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { publicSolanaRpc } from "@/lib/capabilities";
import {
  getBuyPresets,
  resetBuyPresets,
  serverBuyPresets,
  setBuyPresets,
  subscribeBuyPresets,
} from "@/lib/buy-prefs";

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
 * Fee headroom reserved before a buy is allowed.
 *
 * A buy costs `solAmount` plus the in-app fee (2% treasury, +1% creator when the
 * clip has one), the network fee, and — on a first buy of a token — the ATA rent.
 * Reserving a flat 3% + a small fixed buffer keeps the button from offering a
 * trade the wallet cannot actually pay for.
 */
const EST_FEE_RATE = 0.03;
const EST_FIXED_SOL = 0.005;

/** What a buy of `sol` really needs on-chain, incl. fees and rent. */
function requiredSolForBuy(sol: number): number {
  return sol * (1 + EST_FEE_RATE) + EST_FIXED_SOL;
}

/**
 * Turn a simulation failure into something a trader can act on.
 *
 * We simulate before signing precisely so the common failures (no SOL, price
 * moved, stale quote) surface as plain language here — instead of Privy
 * answering with its own generic "Something went wrong" screen, which is what
 * happened before and told the user nothing.
 */
function describeSimFailure(err: unknown, logs: string[] | null): string {
  const text = `${typeof err === "string" ? err : JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/insufficient (lamports|funds)|Transfer: insufficient|0x1\b/i.test(text)) {
    return "Not enough SOL in your wallet for this trade, including fees";
  }
  if (/slippage|ExceededSlippage|0x1771|TooLittleSolReceived/i.test(text)) {
    return "Price moved too far — refresh the quote and try again";
  }
  if (/blockhash|BlockhashNotFound|expired/i.test(text)) {
    return "This quote expired — tap the buy button again for a fresh one";
  }
  return "That swap would fail on-chain — try a smaller amount or refresh the quote";
}

/** True when the failure means the quote's blockhash is simply stale. */
function isStaleQuote(err: unknown, logs: string[] | null): boolean {
  const text = `${typeof err === "string" ? err : JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  return /blockhash|BlockhashNotFound|expired/i.test(text);
}

/**
 * Privy wraps signing errors with a generic top-level message; the real reason
 * lives on `.cause` / `.details`. Dig it out, and map the common ones.
 */
function describeSignError(e: unknown): string {
  const anyE = e as {
    message?: string;
    details?: string;
    cause?: { message?: string };
    error?: { message?: string };
  };
  const candidates = [
    anyE?.cause?.message,
    anyE?.error?.message,
    anyE?.details,
    anyE?.message,
  ].filter((m): m is string => typeof m === "string" && m.trim().length > 0);

  // Drop the useless generic one if anything more specific exists.
  const specific = candidates.find((m) => !/^something went wrong\.?$/i.test(m.trim()));
  const raw = specific ?? candidates[0] ?? "transaction failed";

  if (/user (rejected|denied|cancell?ed)|rejected the request|cancell?ed by user/i.test(raw)) {
    return "You cancelled the signature";
  }
  if (/insufficient (lamports|funds)|0x1\b/i.test(raw)) {
    return "Not enough SOL in your wallet for this trade, including fees";
  }
  if (/slippage|ExceededSlippage|0x1771/i.test(raw)) {
    return "Price moved too far — refresh the quote and try again";
  }
  if (/network|fetch|timeout|rpc/i.test(raw)) {
    return "Network hiccup sending the transaction — try again";
  }
  return raw;
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
 * A buy also carries the in-app fee: 2% to the treasury vault, plus 1% to the
 * clip's creator when the clip the buyer came through has one (an unclaimed
 * clip has none, so the buy is 2% only). Appended to the swap as SOL transfers
 * so they settle with it or not at all. The review step shows exactly what they
 * cost.
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
  const { trader, refresh, toast, solUsd } = useTrader();
  const { getAccessToken } = usePrivy();
  // Sign-in through `useAuth`, so a desktop buy button raises the mobile gate
  // rather than a login modal for an app this machine cannot run.
  const { login } = useAuth();
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

  // The four quick-pick buy amounts belong to the viewer (lib/buy-prefs.ts), so
  // a trader who always buys the same size sets it once instead of retyping.
  const presets = useSyncExternalStore(subscribeBuyPresets, getBuyPresets, serverBuyPresets);
  const [editingPresets, setEditingPresets] = useState(false);
  const [draft, setDraft] = useState<string[]>(["", "", "", ""]);
  const touchedAmount = useRef(false);

  // Seed the buy amount from the viewer's second preset once, unless they have
  // already typed a figure or tapped a preset in this session.
  useEffect(() => {
    if (touchedAmount.current) return;
    const seed = presets[1] ?? presets[0];
    if (seed) setSolAmount(seed);
  }, [presets]);

  const chooseAmount = useCallback((n: number) => {
    touchedAmount.current = true;
    setSolAmount(n);
  }, []);

  const wallet = wallets[0] ?? null;
  const canTrade = trader?.canTrade !== false;

  // Real balances only. These are read from chain, never from a local estimate.
  const loadBalances = useCallback(async () => {
    if (!wallet?.address) return;
    try {
      const r = await fetch(
        `/api/wallet/balance?address=${encodeURIComponent(wallet.address)}&mint=${encodeURIComponent(coin.mint)}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (Number.isFinite(j.sol)) setLiveSol(j.sol);
      if (Number.isFinite(j.tokens)) setLiveHeld(j.tokens);
    } catch {
      /* RPC busy — keep the last known values rather than blanking the sheet */
    }
  }, [wallet?.address, coin.mint]);

  useEffect(() => {
    if (!open) return;
    void loadBalances();
  }, [open, loadBalances, result]);

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

      // Simulate the exact bytes before asking the wallet to sign them.
      //
      // This is the fix for the old dead end: a swap that was going to fail
      // (empty wallet, price moved, dead blockhash) used to be handed straight
      // to Privy, which answered with a generic "Something went wrong" screen.
      // Simulating first lets us find out *why* and say it in plain words.
      let tx: VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(b64ToBytes(liveQuote.transaction));
      } catch {
        throw new Error("Could not read the swap this app built — try again");
      }

      let simErr: unknown = null;
      let simLogs: string[] | null = null;
      try {
        const conn = new Connection(publicSolanaRpc(), "confirmed");
        const sim = await conn.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: false,
        });
        simErr = sim.value.err;
        simLogs = sim.value.logs ?? null;
      } catch {
        // RPC unreachable — that is not a verdict on the trade, so let the
        // wallet attempt it rather than block the user on our own outage.
      }
      if (simErr) {
        if (isStaleQuote(simErr, simLogs)) setLiveQuote(null);
        throw new Error(describeSimFailure(simErr, simLogs));
      }

      // The private key never leaves Privy: we hand over transaction bytes and
      // get back a signature.
      const sigBytes = await signAndSendTransaction({
        transaction: new Uint8Array(b64ToBytes(liveQuote.transaction)),
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
      const m = describeSignError(e);
      setResult(m);
      toast(m, "bad");
      // A failed send usually means the balance moved under us — re-read it so
      // the sheet stops offering a trade this wallet cannot cover.
      void loadBalances();
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
    loadBalances,
  ]);

  if (!open) return null;

  const heldForSell = liveHeld ?? 0;
  // What the trade really needs on-chain, fees included.
  const requiredSol = side === "BUY" ? requiredSolForBuy(solAmount) : 0;
  // Wallet cannot cover the trade plus its fees — block it here rather than let
  // it die inside the wallet's signing screen with a generic error.
  const shortfall = side === "BUY" && liveSol != null && requiredSol > liveSol;
  const disabled =
    busy ||
    !canTrade ||
    shortfall ||
    (side === "BUY" ? solAmount <= 0 : heldForSell <= 0 || fraction <= 0);
  const reviewing = liveQuote !== null;
  const fees = liveQuote?.fees;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={close}
        className="scrim-in absolute inset-0 bg-black/70 backdrop-blur-sm"
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
            <div className="flex items-center gap-1.5 truncate text-sm font-bold">
              <span className="truncate">
                {coin.name} <span className="text-muted">${sym(coin.symbol)}</span>
              </span>
              {/* The pair, on the screen where money changes hands. A coin quoted
                  against NVDAX is not a SOL pair, and that is the single thing a
                  buyer most needs to see before signing. */}
              {coin.quoteSymbol && (
                <PairBadge
                  className="shrink-0"
                  label={coin.quoteName ?? coin.quoteSymbol}
                  title={`paired with ${coin.quoteName ?? coin.quoteSymbol}`}
                  iconUrl={coin.quoteIconUrl}
                />
              )}
            </div>
            <div className="text-[11px] text-muted tabular-nums">
              {fmtPrice(coin.priceSol)} SOL · MC {fmtUsd(coin.marketCapSol * solUsd)}
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
                    label="treasury · 2%"
                    value={`${fmtSol(fees.treasurySol)} SOL`}
                  />
                  <div className="border-t border-line pt-1.5">
                    <Row label="total fee on top" value={`${fmtSol(fees.totalSol)} SOL`} />
                  </div>
                </div>
              </div>
            )}

            {shortfall && liveSol != null && (
              <p className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-[11px] text-down">
                Your balance is now below this trade — go back and lower the amount.
              </p>
            )}

            <button
              onClick={() => void signAndConfirm()}
              disabled={busy || shortfall}
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
              Your wallet signs this locally — Pemp never sees your key. Amounts are re-read
              from the chain when the trade is recorded.
            </p>
          </div>
        )}

        {/* ---------------- amount form ---------------- */}
        {!reviewing && (
          <>
            {side === "BUY" ? (
              <div className="px-4 pt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Quick buy amounts
                  </span>
                  <button
                    onClick={() => {
                      setDraft(presets.map((p) => String(p)));
                      setEditingPresets((v) => !v);
                    }}
                    className="text-[10px] font-semibold text-muted hover:text-ink"
                  >
                    {editingPresets ? "Cancel" : "Edit"}
                  </button>
                </div>

                {!editingPresets && (
                  <div className="grid grid-cols-4 gap-2">
                    {presets.map((p) => (
                      <button
                        key={p}
                        onClick={() => chooseAmount(p)}
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
                )}

                {editingPresets && (
                  <div className="rounded-xl border border-line bg-panel2 p-3">
                    <p className="text-[11px] leading-relaxed text-muted">
                      Set the four amounts you trade most. Saved on this device.
                    </p>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {draft.map((v, i) => (
                        <input
                          key={i}
                          value={v}
                          onChange={(e) =>
                            setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))
                          }
                          inputMode="decimal"
                          aria-label={`Buy amount ${i + 1}`}
                          className="w-full rounded-lg border border-line bg-panel px-2 py-2 text-center text-xs font-bold tabular-nums outline-none focus:border-accent"
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => {
                          const nums = draft.map((x) => Number(x));
                          if (nums.some((n) => !Number.isFinite(n) || n <= 0)) {
                            toast("Enter four amounts above 0", "bad");
                            return;
                          }
                          const clean = setBuyPresets(nums);
                          setDraft(clean.map((p) => String(p)));
                          setEditingPresets(false);
                          toast("Buy amounts saved");
                        }}
                        className="flex-1 rounded-lg burn-gradient py-2 text-[11px] font-black text-black"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          const def = resetBuyPresets();
                          setDraft(def.map((p) => String(p)));
                          toast("Buy amounts reset");
                        }}
                        className="rounded-lg border border-line px-3 py-2 text-[11px] font-semibold text-muted hover:text-ink"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={solAmount}
                    onChange={(e) => chooseAmount(Number(e.target.value))}
                    className="w-full bg-transparent text-lg font-bold tabular-nums outline-none"
                  />
                  <span className="text-xs font-semibold text-muted">SOL</span>
                </div>

                {shortfall && liveSol != null && (
                  <div className="mt-2 rounded-lg border border-down/40 bg-down/10 px-3 py-2">
                    <p className="text-[11px] text-down">
                      This buy needs ≈{fmtSol(requiredSol, requiredSol < 1 ? 4 : 3)} SOL with fees —
                      wallet holds {fmtSol(liveSol, liveSol < 1 ? 4 : 3)} SOL.
                    </p>
                    <a
                      href="/account"
                      className="mt-1 inline-block text-[11px] font-bold text-down underline"
                    >
                      Top up your wallet →
                    </a>
                  </div>
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
              {side === "BUY" && <Row label="in-app fee" value="+2% app (+1% to the clip's creator)" />}
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

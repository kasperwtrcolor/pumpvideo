"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAddFunds, usePrivy } from "@privy-io/react-auth";
import {
  useExportWallet,
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import { QRCodeSVG } from "qrcode.react";
import { useTrader } from "./TraderProvider";
import { shortAddr } from "@/lib/format";
import { LEGAL_LINKS } from "@/lib/legal";

const LAMPORTS = 1_000_000_000;
const BASE_FEE_LAMPORTS = 5_000;
const EXPLORER = "https://explorer.solana.com";

/** Solana mainnet genesis hash — the CAIP-2 chain id Privy's funding flow wants. */
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

type View = "main" | "receive" | "withdraw" | "export";

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`min-w-0 truncate text-right text-[12px] ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { exportWallet } = useExportWallet();
  const { addFunds } = useAddFunds();
  const { trader, refresh, toast, solUsd } = useTrader();

  const [view, setView] = useState<View>("main");
  const [balance, setBalance] = useState<number | null>(null);
  const [balErr, setBalErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [lastSig, setLastSig] = useState<string | null>(null);

  const wallet = wallets[0] ?? null;
  const address = wallet?.address ?? trader?.walletAddress ?? null;

  const loadBalance = useCallback(async () => {
    if (!address) return;
    setBalErr(false);
    try {
      const r = await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok && Number.isFinite(j.sol)) {
        setBalance(j.sol);
        setBalErr(false);
      } else {
        setBalErr(true);
      }
    } catch {
      setBalErr(true);
    }
  }, [address]);

  useEffect(() => {
    if (!open) return;
    setView("main");
    void loadBalance();
  }, [open, loadBalance]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address is still visible to copy by hand */
    }
  }, []);

  const doWithdraw = useCallback(async () => {
    if (!wallet || !address) return;
    setBusy(true);
    setLastSig(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("session expired — log in again");

      // Ask the server to validate the transfer and hand back a blockhash.
      const prep = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ to: dest.trim(), amountSol: Number(amount) }),
      });
      const p = await prep.json();
      if (!prep.ok) throw new Error(p.detail || p.error || "withdrawal rejected");

      // Build locally. The private key never leaves Privy's iframe: we hand
      // over an unsigned transaction and receive back a signature.
      const from = new PublicKey(p.from);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: new PublicKey(p.to),
          lamports: p.lamports,
        }),
      );
      tx.feePayer = from;
      tx.recentBlockhash = p.blockhash;

      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const { signature } = await signAndSendTransaction({
        transaction: new Uint8Array(serialized),
        wallet,
        chain: "solana:mainnet",
      });

      const sig = getBase58Decoder().decode(signature);
      setLastSig(sig);
      setDest("");
      setAmount("");
      toast("Withdrawal sent");
      setTimeout(() => void loadBalance(), 2500);
    } catch (e) {
      toast((e as Error).message || "Withdrawal failed", "bad");
    } finally {
      setBusy(false);
    }
  }, [wallet, address, getAccessToken, dest, amount, signAndSendTransaction, toast, loadBalance]);

  const doTopUp = useCallback(async () => {
    if (!address) return;
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
          ? "Card top-up isn't enabled on this app yet — use Receive instead"
          : msg || "Top-up unavailable",
        "bad",
      );
    } finally {
      setBusy(false);
    }
  }, [address, addFunds, toast]);

  const doExport = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    try {
      await exportWallet({ address });
    } catch (e) {
      toast((e as Error).message || "Export unavailable", "bad");
    } finally {
      setBusy(false);
    }
  }, [address, exportWallet, toast]);

  const doLogout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      await logout();
      await refresh();
      onClose();
      toast("Signed out");
    } catch {
      toast("Sign out failed", "bad");
    } finally {
      setBusy(false);
    }
  }, [logout, refresh, onClose, toast]);

  if (!open) return null;

  const sol = balance ?? 0;
  const maxWithdraw = balance != null ? Math.max(0, (balance - BASE_FEE_LAMPORTS) / LAMPORTS) : 0;
  const loginLabel =
    trader?.loginMethod === "GOOGLE"
      ? "Google"
      : trader?.loginMethod === "TWITTER"
        ? "X (Twitter)"
        : "Email";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <button aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <div className="sheet-up relative flex max-h-[88dvh] w-full max-w-[440px] flex-col overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-4 pb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view !== "main" && (
              <button
                onClick={() => setView("main")}
                className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink"
              >
                ← Back
              </button>
            )}
            <h2 className="text-sm font-bold tracking-wide">
              {view === "main"
                ? "Wallet"
                : view === "receive"
                  ? "Receive"
                  : view === "withdraw"
                    ? "Withdraw"
                    : "Export key"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full border border-line text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* ---------- main ---------- */}
        {view === "main" && (
          <>
            <div className="burn-gradient rounded-2xl p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
                Solana balance
              </div>
              <div className="mt-1 text-3xl font-black tabular-nums text-white">
                {balance == null ? (balErr ? "—" : "…") : sol.toFixed(6)}
                <span className="ml-1 text-base font-bold text-white/80">SOL</span>
              </div>
              <div className="text-[12px] font-semibold text-white/80">
                {balance == null ? "" : `≈ $${(sol * solUsd).toFixed(2)} USD`}
              </div>
              {address && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-white/90">{shortAddr(address, 6)}</span>
                  <button
                    onClick={() => void copy(address)}
                    className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={`${EXPLORER}/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white"
                  >
                    Explorer ↗
                  </a>
                </div>
              )}
              {balErr && (
                <div className="mt-2 text-[10px] text-white/80">
                  Balance unavailable — RPC busy. Pull refresh below.
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setView("receive")}
                disabled={!address}
                className="rounded-xl border border-line bg-panel2 py-2.5 text-[12px] font-bold hover:border-accent disabled:opacity-50"
              >
                Top up
              </button>
              <button
                onClick={() => setView("withdraw")}
                disabled={!address}
                className="rounded-xl border border-line bg-panel2 py-2.5 text-[12px] font-bold hover:border-accent disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-line bg-panel2 px-3">
              <Row label="Account" value={trader?.email ?? "anon"} />
              <div className="border-t border-line" />
              <Row label="Signed in via" value={loginLabel} />
            </div>

            <button
              onClick={() => setView("export")}
              className="mt-3 w-full rounded-xl border border-line py-2 text-[11px] font-semibold text-muted hover:text-ink"
            >
              Export private key
            </button>

            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              Funds in this wallet are yours — PumpClip never holds your keys and cannot
              move them. Buys and sells are signed by this wallet and settle on Solana
              mainnet.
            </p>

            <div className="mt-4 border-t border-line pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Legal
              </div>
              <div className="mt-2 flex flex-col">
                {LEGAL_LINKS.map((l) => (
                  <Link
                    key={l.doc}
                    href={l.href}
                    onClick={onClose}
                    className="flex items-center justify-between py-1.5 text-[11px] text-muted hover:text-ink"
                  >
                    <span>{l.label}</span>
                    <span aria-hidden>›</span>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                Memecoins are highly speculative and can lose all their value. Nothing here
                is investment advice.
              </p>
            </div>

            <button
              onClick={() => void doLogout()}
              disabled={busy}
              className="mt-3 w-full rounded-xl border border-line py-2 text-[11px] font-semibold text-down hover:border-down disabled:opacity-50"
            >
              Sign out
            </button>
          </>
        )}

        {/* ---------- receive / top up ---------- */}
        {view === "receive" && address && (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-2xl bg-white p-3">
                <QRCodeSVG value={address} size={168} level="M" />
              </div>
              <div className="w-full break-all rounded-xl border border-line bg-panel2 p-3 text-center font-mono text-[11px]">
                {address}
              </div>
              <button
                onClick={() => void copy(address)}
                className="w-full rounded-xl border border-line bg-panel2 py-2.5 text-[12px] font-bold hover:border-accent"
              >
                {copied ? "Copied ✓" : "Copy address"}
              </button>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              Send SOL (or any SPL token) on <strong className="text-ink">Solana mainnet</strong> to
              this address from an exchange or another wallet. It arrives in seconds.
              Only send assets on Solana — anything bridged from another chain is
              unrecoverable.
            </p>

            <button
              onClick={() => void doTopUp()}
              disabled={busy}
              className="mt-3 w-full rounded-xl border border-line py-2 text-[11px] font-semibold text-muted hover:text-ink disabled:opacity-50"
            >
              {busy ? "Opening…" : "Or buy with a card"}
            </button>
          </>
        )}

        {/* ---------- withdraw ---------- */}
        {view === "withdraw" && address && (
          <>
            <div className="rounded-xl border border-line bg-panel2 p-3">
              <Row
                label="Available"
                value={balance == null ? "…" : `${sol.toFixed(6)} SOL`}
              />
            </div>

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Destination address
            </label>
            <input
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="Solana wallet address"
              spellCheck={false}
              className="mt-1 w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 font-mono text-[12px] outline-none focus:border-accent"
            />

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Amount (SOL)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-[13px] tabular-nums outline-none focus:border-accent"
              />
              <button
                onClick={() => setAmount(maxWithdraw > 0 ? maxWithdraw.toFixed(6) : "")}
                className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-[11px] font-bold text-muted hover:text-ink"
              >
                Max
              </button>
            </div>
            <div className="mt-1 flex gap-1.5">
              {[25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() =>
                    setAmount(((maxWithdraw * pct) / 100).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""))
                  }
                  className="rounded-full border border-line px-2.5 py-0.5 text-[10px] font-semibold text-muted hover:text-ink"
                >
                  {pct}%
                </button>
              ))}
            </div>

            <button
              onClick={() => void doWithdraw()}
              disabled={busy || !dest.trim() || !amount}
              className="mt-4 w-full rounded-xl burn-gradient py-3 text-[13px] font-black text-white disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Withdraw"}
            </button>

            {lastSig && (
              <a
                href={`${EXPLORER}/tx/${lastSig}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block break-all rounded-xl border border-up/40 bg-up/10 p-3 text-[11px] text-up"
              >
                Sent ✓ — view on Explorer ↗
                <div className="mt-1 font-mono text-[10px] opacity-80">{lastSig}</div>
              </a>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              You&apos;ll approve the transfer in the Privy prompt. Check the address carefully —
              Solana transfers are irreversible.
            </p>
          </>
        )}

        {/* ---------- export ---------- */}
        {view === "export" && address && (
          <>
            <div className="rounded-xl border border-down/40 bg-down/10 p-3 text-[11px] leading-relaxed text-ink">
              <strong className="text-down">Your private key is the wallet.</strong> Anyone who
              sees it can take every asset in it, forever. Never share it, never paste it into a
              site, and never send it over chat.
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Privy will open a secure window to reveal the key. It renders on a separate
              domain from PumpClip, so this app can never read it.
            </p>
            <button
              onClick={() => void doExport()}
              disabled={busy}
              className="mt-4 w-full rounded-xl border border-line bg-panel2 py-3 text-[12px] font-bold hover:border-down disabled:opacity-50"
            >
              {busy ? "Opening…" : "Reveal private key"}
            </button>
            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              Tip: most people never need to export. The wallet can send, receive and be
              recovered without it.
            </p>
          </>
        )}

        {!address && (
          <div className="py-8 text-center text-[12px] text-muted">
            No wallet on this account yet.
            {user ? " It may still be being created — reopen in a moment." : ""}
          </div>
        )}
      </div>
    </div>
  );
}
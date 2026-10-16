"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { QRCodeSVG } from "qrcode.react";
import { signSiwsChallenge } from "@/lib/siws-client";
import { useAuth } from "./AuthBridge";
import { useTrader } from "./TraderProvider";
import { CheckIcon, ExternalIcon } from "./Icons";
import { fmtUsd, shortAddr } from "@/lib/format";
import { LEGAL_LINKS } from "@/lib/legal";
import {
  getAccountView,
  setAccountView,
  subscribeAccountView,
  type AccountView,
} from "@/lib/account-view";

const LAMPORTS = 1_000_000_000;
const BASE_FEE_LAMPORTS = 5_000;
const EXPLORER = "https://explorer.solana.com";

/**
 * fmtUsd, but a flat zero reads as money rather than "$0.0000".
 *
 * fmtUsd drops to four decimals below a dollar so sub-cent balances stay
 * visible, which is right for a price and wrong for a total that happens to be
 * nothing. Anything non-zero still goes through fmtUsd unchanged, so the
 * portfolio total stays character-for-character identical to the header's.
 */
const money = (n: number | null) => (n == null ? "—" : n === 0 ? "$0.00" : fmtUsd(n));

type View = AccountView;

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

export function AccountPanel() {
  const { getToken } = useAuth();
  const router = useRouter();
  const { publicKey, sendTransaction, signMessage, disconnect, wallet } = useWallet();
  const { connection } = useConnection();
  const { trader, account, refresh, toast, solUsd } = useTrader();

  // Which panel is showing lives in lib/account-view.ts, so the header's
  // Deposit button can open the Receive panel from outside this component.
  const view = useSyncExternalStore(subscribeAccountView, getAccountView, () => "main" as View);
  const setView = setAccountView;
  const [balance, setBalance] = useState<number | null>(null);
  const [balErr, setBalErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [lastSig, setLastSig] = useState<string | null>(null);
  /** Own sign-out confirmation. Privy's own modal is unreliable on small screens. */
  const [confirmLogout, setConfirmLogout] = useState(false);

  const address = publicKey?.toBase58() ?? trader?.walletAddress ?? null;

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
    void loadBalance();
  }, [loadBalance]);

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
    if (!address) return;
    setBusy(true);
    setLastSig(null);
    try {
      const accessToken = await getToken();
      if (!accessToken) throw new Error("connect your wallet first");

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

      // Build locally and let the wallet sign it — the key never leaves the
      // extension, and the app never sees it.
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

      const sig = await sendTransaction(tx, connection);
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
  }, [address, getToken, dest, amount, sendTransaction, connection, toast, loadBalance]);

  /**
   * Point creator fees at the connected wallet, proven by a signature.
   *
   * Fees are paid to whatever `creatorWallet` a clip froze at upload, and a
   * creator can now swap wallets — so this re-points the trader AND their
   * existing clips at the wallet they are actually using.
   */
  const doSetPayout = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setBusy(true);
    try {
      const walletAddr = publicKey.toBase58();
      const nonceRes = await fetch(
        `/api/auth/siws/nonce?wallet=${encodeURIComponent(walletAddr)}&purpose=payout`,
        { cache: "no-store" },
      );
      if (!nonceRes.ok) throw new Error("could not start");
      const { message } = (await nonceRes.json()) as { message: string };

      const sigBytes = await signSiwsChallenge({ message, walletName: wallet?.adapter.name, signMessage });
      const signature = btoa(String.fromCharCode(...sigBytes));

      const r = await fetch("/api/account/payout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${walletAddr}`,
        },
        body: JSON.stringify({ wallet: walletAddr, message, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || "could not update payout");
      toast("Payout wallet updated");
      await refresh();
    } catch (e) {
      toast((e as Error).message || "Payout update failed", "bad");
    } finally {
      setBusy(false);
    }
  }, [publicKey, signMessage, wallet, refresh, toast]);

  const doLogout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      await disconnect();
      await refresh();
      // The account route is useless without a session, so go back to the feed.
      router.push("/");
      toast("Signed out");
    } catch {
      toast("Sign out failed", "bad");
    } finally {
      setBusy(false);
    }
  }, [disconnect, refresh, router, toast]);

  const sol = balance ?? 0;
  const maxWithdraw = balance != null ? Math.max(0, (balance - BASE_FEE_LAMPORTS) / LAMPORTS) : 0;
  const loginLabel =
    trader?.loginMethod === "GOOGLE"
      ? "Google"
      : trader?.loginMethod === "TWITTER"
        ? "X (Twitter)"
        : trader?.loginMethod === "WALLET"
          ? "Solana wallet"
          : "Email";

  return (
    <>
      <section className="rounded-2xl border border-line bg-panel p-4">
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
                    : "Payout wallet"}
            </h2>
          </div>
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

            {/* The header shows a *portfolio* — cash plus the value of what you
                hold — so this card has to reconcile with it. Reading only the
                SOL balance here made the same account look like $18 in one
                place and $30 in another, with nothing to say why. */}
            {account && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Portfolio
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">
                    cash {money(account.walletSol == null ? null : account.walletSol * solUsd)} +
                    positions {money(account.holdingsValue * solUsd)}
                  </div>
                </div>
                <div className="shrink-0 text-[15px] font-black tabular-nums">
                  {money(((account.walletSol ?? 0) + account.holdingsValue) * solUsd)}
                </div>
              </div>
            )}

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
              <Row label="Wallet" value={address ? shortAddr(address, 6) : "anon"} mono />
              <div className="border-t border-line" />
              <Row label="Connected via" value={loginLabel} />
            </div>

            <button
              onClick={() => setView("payout")}
              className="mt-3 w-full rounded-xl border border-line py-2 text-[11px] font-semibold text-muted hover:text-ink"
            >
              Payout wallet
            </button>

            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              Funds in this wallet are yours — Pemp never holds your keys and cannot
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
              onClick={() => setConfirmLogout(true)}
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
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-panel2 py-2.5 text-[12px] font-bold hover:border-accent"
              >
                {copied ? (
                  <>
                    <CheckIcon key="c" className="star-pop h-3.5 w-3.5 text-accent" />
                    Copied
                  </>
                ) : (
                  "Copy address"
                )}
              </button>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              Send SOL (or any SPL token) on <strong className="text-ink">Solana mainnet</strong> to
              this address from an exchange or another wallet. It arrives in seconds.
              Only send assets on Solana — anything bridged from another chain is
              unrecoverable.
            </p>

            <button
              onClick={() => setView("receive")}
              className="mt-3 w-full rounded-xl border border-line py-2 text-[11px] font-semibold text-muted hover:text-ink"
            >
              ← Back
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
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <CheckIcon className="h-3.5 w-3.5" />
                  Sent — view on Explorer
                  <ExternalIcon className="h-3 w-3" />
                </span>
                <div className="mt-1 font-mono text-[10px] opacity-80">{lastSig}</div>
              </a>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              You&apos;ll approve the transfer in your wallet. Check the address carefully —
              Solana transfers are irreversible.
            </p>
          </>
        )}

        {/* ---------- payout wallet ---------- */}
        {view === "payout" && address && (
          <>
            <p className="text-[11px] leading-relaxed text-muted">
              Creator fees — the 1% paid on every buy made through your clip — go to{" "}
              <span className="font-mono text-ink">{shortAddr(address, 6)}</span>. If you move
              to a new wallet, set it here so your existing clips pay there too.
            </p>
            <button
              onClick={() => void doSetPayout()}
              disabled={busy}
              className="mt-4 w-full rounded-xl border border-line bg-panel2 py-3 text-[12px] font-bold hover:border-accent disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Use connected wallet"}
            </button>
            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              Requires a signature from the wallet — it proves you control the address fees
              would be sent to. It costs nothing and sends no transaction.
            </p>
          </>
        )}

        {!address && (
          <div className="py-8 text-center text-[12px] text-muted">
            Connect a Solana wallet to see it here.
          </div>
        )}
      </section>

      {confirmLogout && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-title"
          className="fixed inset-0 z-[80] grid place-items-center bg-black/80 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
        >
          <button
            aria-label="Cancel"
            className="absolute inset-0"
            onClick={() => setConfirmLogout(false)}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-panel p-5 text-center">
            <h2 id="signout-title" className="text-base font-bold tracking-tight">
              Sign out?
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              You can log back in any time. Your wallet and its funds stay attached to your
              account.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-xl border border-line bg-panel2 py-2.5 text-[12px] font-bold hover:border-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmLogout(false);
                  void doLogout();
                }}
                disabled={busy}
                className="flex-1 rounded-xl border border-down py-2.5 text-[12px] font-bold text-down hover:bg-down/10 disabled:opacity-50"
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signSiwsChallenge } from "@/lib/siws-client";
import { useTrader } from "./TraderProvider";

/**
 * Bridges a connected wallet into an app session, via SIWS.
 *
 * Connecting a wallet is not by itself proof of ownership to the server — the
 * wallet must SIGN a challenge. So on connect we fetch a nonce, sign the message
 * with the wallet, and hand the signature to `/api/auth/session`, which verifies
 * it and mints the session cookie. The rest of the app then talks to its own
 * trader row as it always has.
 *
 * The ref guard keeps this to one handshake per wallet address, so re-renders
 * don't prompt for a signature repeatedly. Disconnecting clears the app session
 * so the next request provisions a fresh anonymous trader.
 */
export function SiwsSession() {
  const { publicKey, connected, signMessage, disconnect, wallet: activeWallet } = useWallet();
  const { refresh, toast } = useTrader();
  const synced = useRef<string | null>(null);
  const wasConnected = useRef(false);

  useEffect(() => {
    // Signed out — end the app session so the server forgets the wallet.
    if (!connected || !publicKey) {
      if (wasConnected.current) {
        wasConnected.current = false;
        synced.current = null;
        void fetch("/api/auth/session", { method: "DELETE" })
          .then(() => refresh())
          .catch(() => {});
      }
      return;
    }

    wasConnected.current = true;
    const wallet = publicKey.toBase58();
    if (synced.current === wallet) return;

    let cancelled = false;
    (async () => {
      try {
        if (!signMessage) throw new Error("this wallet cannot sign messages");

        // 1. Challenge.
        const nonceRes = await fetch(
          `/api/auth/siws/nonce?wallet=${encodeURIComponent(wallet)}`,
          { cache: "no-store" },
        );
        if (!nonceRes.ok) throw new Error("could not start sign-in");
        const { message } = (await nonceRes.json()) as { message: string };

        // 2. Sign it with the wallet (a plain message signature — no transaction).
        const sigBytes = await signSiwsChallenge({
          message,
          walletName: activeWallet?.adapter.name,
          signMessage,
        });
        const signature = btoa(String.fromCharCode(...sigBytes));

        // 3. Exchange the signed challenge for a session.
        const sessionRes = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet, message, signature }),
        });
        if (cancelled) return;
        if (!sessionRes.ok) {
          synced.current = null;
          toast("Couldn't start your session", "bad");
          return;
        }
        synced.current = wallet;
        await refresh();
      } catch (e) {
        if (cancelled) return;
        synced.current = null;
        const msg = (e as Error).message || "";
        // A user who closes the wallet prompt is not an error worth shouting about.
        if (!/reject|denied|cancel/i.test(msg)) toast(msg || "Sign-in failed", "bad");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, signMessage, activeWallet, refresh, toast, disconnect]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useTrader } from "./TraderProvider";

/**
 * Bridges a Privy session into an app session.
 *
 * Privy authenticates the *person*; this app still needs its own trader row to
 * hang likes, comments, uploads, positions and the trade log off. On login we hand the
 * tokens to `/api/auth/session`, which verifies them server-side and returns the
 * trader that the rest of the app already knows how to talk to.
 *
 * The ref guard keeps this to at most one call per Privy user per mount (plus a
 * single repeat if the identity token arrives after the access token), so
 * routine re-renders don't spam the endpoint.
 */
export function PrivySessionSync() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refresh, toast } = useTrader();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !user) {
      // Signed out — permit the next login (even by the same user) to re-sync.
      synced.current = null;
      return;
    }

    const key = `${user.id}:${identityToken ? "id" : "noid"}`;
    if (synced.current === key) return;
    synced.current = key;

    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          synced.current = null;
          return;
        }
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken, identityToken: identityToken ?? undefined }),
        });
        if (cancelled) return;
        if (!res.ok) {
          synced.current = null;
          toast("Couldn't start your session", "bad");
          return;
        }
        await refresh();
      } catch {
        if (!cancelled) {
          synced.current = null;
          toast("Couldn't reach the server", "bad");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user, identityToken, getAccessToken, refresh, toast]);

  return null;
}
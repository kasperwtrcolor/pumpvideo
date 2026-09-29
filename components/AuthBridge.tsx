"use client";

import { createContext, useContext, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { privyEnabled } from "./PrivyRoot";

/**
 * Auth, available whether or not Privy is configured.
 *
 * `usePrivy()` throws when there is no `PrivyProvider` above it, and hooks
 * cannot be called conditionally — so the enabled and disabled cases are two
 * different components and this picks one. That keeps every consumer free to
 * call `useAuth()` at the top level of its own component without a guard.
 *
 * When Privy is unconfigured the feed still works fully; liking, commenting and
 * uploading simply report that login is unavailable.
 */
export type Auth = {
  enabled: boolean;
  authenticated: boolean;
  login: () => void;
  /** Bearer token for our own API, or null when signed out. */
  getToken: () => Promise<string | null>;
};

const Disabled: Auth = {
  enabled: false,
  authenticated: false,
  login: () => {},
  getToken: async () => null,
};

const AuthCtx = createContext<Auth>(Disabled);

export function useAuth(): Auth {
  return useContext(AuthCtx);
}

function EnabledAuth({ children }: { children: React.ReactNode }) {
  const { authenticated, login, getAccessToken, ready } = usePrivy();

  const value = useMemo<Auth>(
    () => ({
      enabled: true,
      authenticated: ready && authenticated,
      login: () => void login(),
      getToken: async () => (await getAccessToken()) ?? null,
    }),
    [ready, authenticated, login, getAccessToken],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthBridge({ children }: { children: React.ReactNode }) {
  if (!privyEnabled) return <AuthCtx.Provider value={Disabled}>{children}</AuthCtx.Provider>;
  return <EnabledAuth>{children}</EnabledAuth>;
}

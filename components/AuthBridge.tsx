"use client";

import { createContext, useContext, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useIsDesktop } from "@/lib/use-desktop";
import { showGate } from "@/lib/mobile-gate";

/**
 * Auth, expressed against a connected wallet.
 *
 * Same interface every screen already consumes, so nothing downstream had to
 * change when Privy was removed — only the implementation behind it. Login is now
 * "connect a wallet"; a connected wallet is the authenticated state.
 *
 * The display half of the gate is the same as before: a desktop visitor reaching
 * for the wallet — from a buy button, a like, a comment — gets the phone screen
 * rather than a wallet modal for an app they cannot run here. This is the single
 * point every call site funnels through, which is why the check lives here.
 */
export type Auth = {
  enabled: boolean;
  authenticated: boolean;
  login: () => void;
  /**
   * A bearer marker for our own API, or null when signed out.
   *
   * Not a token: the session is the httpOnly cookie minted after SIWS. This
   * returns the connected wallet address, which the server checks against the
   * wallet the session was issued for — so a request carrying a mismatched wallet
   * is refused even if the cookie leaked.
   */
  getToken: () => Promise<string | null>;
};

const AuthCtx = createContext<Auth>({
  enabled: true,
  authenticated: false,
  login: () => {},
  getToken: async () => null,
});

export function useAuth(): Auth {
  return useContext(AuthCtx);
}

export function AuthBridge({ children }: { children: React.ReactNode }) {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const desktop = useIsDesktop();

  const value = useMemo<Auth>(
    () => ({
      enabled: true,
      authenticated: connected && Boolean(publicKey),
      login: () => {
        if (desktop) {
          showGate();
          return;
        }
        setVisible(true);
      },
      getToken: async () => (publicKey ? publicKey.toBase58() : null),
    }),
    [connected, publicKey, desktop, setVisible],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

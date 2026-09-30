"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

/**
 * Public Privy app id. Inlined at build time, so this is the same value on the
 * server and in the browser — that's what lets the API routes and the client
 * agree on whether login is switched on.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || "";

/** Whether login can be offered on this deployment. */
export const privyEnabled = Boolean(PRIVY_APP_ID);

const RPC_HTTP =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const RPC_WS = RPC_HTTP.replace(/^http/, "ws");

/**
 * Privy needs its own Solana RPC wiring: `signAndSendTransaction` submits
 * through the client configured here, and without an entry for the chain it
 * throws "No RPC configuration found". There is no plugin prop on
 * `PrivyProvider` in this SDK version, so the config is passed explicitly.
 */
const SOLANA_CONFIG = {
  rpcs: {
    "solana:mainnet": {
      rpc: createSolanaRpc(RPC_HTTP),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpcSubscriptions: createSolanaRpcSubscriptions(RPC_WS) as any,
      blockExplorerUrl: "https://explorer.solana.com",
    },
  },
};

const ACCENT = "#22e06a";

/**
 * Wraps the app in `PrivyProvider`, or steps out of the way entirely when no
 * app id is configured.
 *
 * Degrading instead of throwing matters here: a deployment (or a contributor's
 * laptop) without Privy env vars must still boot the feed rather than
 * white-screen — viewing clips never requires a login.
 */
export function PrivyRoot({ children }: { children: React.ReactNode }) {
  if (!privyEnabled) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter"],
        appearance: {
          theme: "#08080A",
          accentColor: ACCENT,
          landingHeader: "Log in to Pogo",
          loginMessage:
            "A Solana wallet is created for you automatically — no extension, no seed phrase.",
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          // Every login gets a Solana wallet — this is the account's trading
          // wallet, and the one top-up / withdraw / export all operate on.
          solana: { createOnLogin: "all-users" },
        },
        solana: SOLANA_CONFIG,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

/**
 * The wallet stack, replacing the old Privy provider.
 *
 * Self-custodial by design: the user brings their own wallet (Phantom, Solflare)
 * and signs with it. There is no embedded wallet and no vendor account, which is
 * the whole point — no per-user cost, no 150-user cap, and the keys never leave
 * the user's extension.
 *
 * `ConnectionProvider` supplies the RPC every `sendTransaction` submits through,
 * so the same endpoint the app reads balances from is the one it signs against.
 */
const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

/** Login is always available now — there is nothing to configure. */
export const walletEnabled = true;

export function WalletRoot({ children }: { children: React.ReactNode }) {
  // Instantiated once; the adapters register themselves with the provider.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

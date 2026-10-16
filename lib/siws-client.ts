/**
 * Client-side SIWS signing, with the Phantom quirk handled.
 *
 * Phantom's injected provider exposes the LEGACY API:
 *
 *   solana.signMessage(message: Uint8Array, display?: "utf8" | "hex")
 *
 * The `display` argument is how Phantom knows how to render the request to the
 * user. `@solana/wallet-adapter-phantom` calls it as `signMessage(message)` —
 * with no display hint — and Phantom will not guess: it answers
 * "this app's signature request cannot be shown due to invalid formatting"
 * instead. So the wallet adapter path is unusable for message signing on
 * Phantom, which is exactly the login step.
 *
 * The fix is to go straight to the injected provider for Phantom and pass
 * "utf8" explicitly. Every other wallet (Solflare, etc.) goes through the
 * adapter as normal, so nothing is Phantom-specific in the app's shape — just
 * this one call.
 */

type InjectedPhantom = {
  signMessage?: (
    message: Uint8Array,
    display?: "utf8" | "hex",
  ) => Promise<{ signature: Uint8Array }>;
};

export async function signSiwsChallenge(opts: {
  message: string;
  /** `useWallet().wallet?.name` — "Phantom", "Solflare", … */
  walletName?: string | null;
  /** `useWallet().signMessage` from the wallet adapter. */
  signMessage?: ((message: Uint8Array) => Promise<Uint8Array>) | null;
}): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(opts.message);

  const injected = (globalThis as { phantom?: { solana?: InjectedPhantom } }).phantom?.solana;
  if (opts.walletName === "Phantom" && typeof injected?.signMessage === "function") {
    const { signature } = await injected.signMessage(bytes, "utf8");
    return signature;
  }

  if (!opts.signMessage) throw new Error("this wallet cannot sign messages");
  return opts.signMessage(bytes);
}

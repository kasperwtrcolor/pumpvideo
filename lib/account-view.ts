/**
 * Which panel the account page is showing.
 *
 * A tiny external store, same shape as lib/welcome.ts and lib/unread.ts,
 * because two components need to drive it and neither owns the other:
 *
 *   - `DepositButton` — the header's money button — sends the visitor to the
 *     Receive panel (the QR code and the copy-address button), which is what
 *     "deposit" means to anyone holding a wallet.
 *   - `AccountPanel` renders whichever panel is current, and its own Back /
 *     Top up / Withdraw buttons move between them.
 *
 * Deliberately not URL state. The header button is a plain `router.push("/account")`,
 * so a `?view=` param would mean the panel could be opened on a URL that does
 * not match what is on screen the moment the visitor taps Back inside the panel
 * — and reading the query would cost a Suspense boundary on a statically
 * rendered page. The store keeps the panel and the URL from disagreeing by
 * keeping the panel out of the URL entirely.
 *
 * The first render is `"main"`: the server render and the client's first paint
 * have to agree, and the wallet view is the right default for someone arriving
 * at /account on their own.
 */

export type AccountView = "main" | "receive" | "withdraw" | "export";

type Listener = () => void;

let view: AccountView = "main";
const listeners = new Set<Listener>();

export function getAccountView(): AccountView {
  return view;
}

export function setAccountView(next: AccountView): void {
  if (next === view) return;
  view = next;
  for (const l of listeners) l();
}

export function subscribeAccountView(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

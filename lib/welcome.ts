/**
 * Whether the welcome screen is open.
 *
 * A tiny external store, same shape as lib/unread.ts, because two components
 * need to drive it and neither owns the other:
 *
 *   - `Landing` puts it up on mount and takes it down when the visitor
 *     dismisses it or signs in.
 *   - `Feed` puts it back up at the every-N-clips milestone, which is how a
 *     signed-out viewer is reminded to log in now that there is no modal.
 *
 * The first render is deliberately `true`. The welcome screen is shown on every
 * load of `/` — a refresh is a fresh decision — so the server render and the
 * client's first paint have to agree, and "open" is what both want.
 */

type Listener = () => void;

let open = true;
const listeners = new Set<Listener>();

export function getWelcomeOpen(): boolean {
  return open;
}

export function setWelcomeOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const l of listeners) l();
}

export function subscribeWelcome(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

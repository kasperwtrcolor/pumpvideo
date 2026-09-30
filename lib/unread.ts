/** How many notifications are unseen. A tiny external store, so the bell and the
 *  feed's banner share one poll instead of each running their own. */

type Listener = () => void;

let unread = 0;
const listeners = new Set<Listener>();

export function getUnread(): number {
  return unread;
}

export function setUnread(n: number): void {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (next === unread) return;
  unread = next;
  for (const l of listeners) l();
}

export function subscribeUnread(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

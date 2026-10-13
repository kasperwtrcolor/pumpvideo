/**
 * Whether the desktop "this is a phone app" gate is up.
 *
 * A tiny external store, same shape as lib/welcome.ts, because two unrelated
 * places need to raise the same screen:
 *
 *   - `Shell` raises it as the whole viewport on a desktop visit to an app
 *     route (`/coins`, `/account`, …) — there is no feed behind it to go back to.
 *   - The desktop landing's own CTAs ("Open the app", "Open the feed", "Start
 *     watching") raise it as an overlay on `/`, because that visitor is reading
 *     the marketing page and asking to go further.
 *
 * The first render is `false` on purpose: unlike the welcome screen, the gate is
 * not part of any page's first paint. It appears only once a desktop visitor
 * asks for something a phone has, so the server render and the client's first
 * frame agree on "closed".
 */

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

export function getGateOpen(): boolean {
  return open;
}

export function showGate(): void {
  if (open) return;
  open = true;
  for (const l of listeners) l();
}

export function hideGate(): void {
  if (!open) return;
  open = false;
  for (const l of listeners) l();
}

export function subscribeGate(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Routes a desktop visitor may still read rather than being gated.
 *
 * `/` is the landing itself. `/legal/*` has to be reachable from a desktop
 * because terms and privacy are meant to be read, not opened on a phone.
 *
 * The two share targets are deliberately *not* here. They are readable on
 * desktop — a permalink posted to X is the payload and dead-ending it would
 * throw that away — but they are the phone feed, and the phone feed stretched
 * across 1280px is the exact thing this gate exists to stop. `Shell` gives them
 * a third arrangement instead: a centred phone-width column. See there.
 */
export function desktopReadable(path: string): boolean {
  if (path === "/") return true;
  if (path.startsWith("/legal")) return true;
  return false;
}

/** A public permalink: a token's wall or a profile. Both are share targets. */
export function isShareRoute(path: string): boolean {
  return path.startsWith("/t/") || path.startsWith("/u/");
}

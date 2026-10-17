/**
 * The viewer's preferred buy amounts.
 *
 * The trade sheet used to hardcode `[0.1, 0.25, 0.5, 1]`, so anyone who always
 * buys the same size — or always trades dust — retyped it every single time.
 * The four quick-pick amounts are now theirs to set.
 *
 * Stored per browser in localStorage. This is a UI preference, not account
 * state: it must never block a trade, so every read and write is wrapped and a
 * failed write still applies in memory for the session.
 *
 * Same tiny external-store shape as lib/account-view.ts, so the sheet (which
 * edits them) and anything else that shows them stay in sync, and the server
 * render and first client paint agree.
 */

/** The out-of-the-box amounts, unchanged from the old hardcoded row. */
const FALLBACK: number[] = [0.1, 0.25, 0.5, 1];
export const DEFAULT_BUY_PRESETS: readonly number[] = FALLBACK;

const KEY = "pemp.buyPresets.v1";
const COUNT = 4;
const MIN = 0.001;
const MAX = 50;

type Listener = () => void;

let cache: number[] | null = null;
const listeners = new Set<Listener>();

/** Coerce anything into exactly four sane, positive amounts — or the defaults. */
function sanitize(input: unknown): number[] {
  const raw = Array.isArray(input) ? input : [];
  const clean: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) clean.push(Math.min(MAX, Math.max(MIN, n)));
  }
  if (clean.length !== COUNT) return [...FALLBACK];
  return clean;
}

function emit(): void {
  for (const l of listeners) l();
}

export function getBuyPresets(): number[] {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = [...FALLBACK];
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : [...FALLBACK];
  } catch {
    // No storage (private mode) or corrupt JSON — fall back, don't throw.
    cache = [...FALLBACK];
  }
  return cache;
}

/** Applies and persists four amounts. Returns the value actually stored. */
export function setBuyPresets(next: unknown): number[] {
  const clean = sanitize(next);
  cache = clean;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* storage unavailable — the in-memory value still applies this session */
  }
  emit();
  return clean;
}

/** Back to `[0.1, 0.25, 0.5, 1]`. */
export function resetBuyPresets(): number[] {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  cache = [...FALLBACK];
  emit();
  return cache;
}

export function subscribeBuyPresets(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Stable server snapshot — `useSyncExternalStore` needs a constant reference. */
export function serverBuyPresets(): number[] {
  return FALLBACK;
}

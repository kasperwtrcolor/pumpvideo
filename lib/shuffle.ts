/**
 * Seeded shuffle — what makes a randomised feed still paginate correctly.
 *
 * The obvious way to randomise is `ORDER BY random()`, and it is wrong here: the
 * feed pages by `offset`, so page 1 and page 2 would be two independent random
 * draws and clips would repeat while others never appeared at all. The same clip
 * could show up twice before you reached the end of one pass.
 *
 * Instead the client mints a seed once per session and every page request
 * re-derives the *same* permutation: fetch a stable pool, shuffle it
 * deterministically with that seed, then slice the requested window out of it.
 * Page 2 continues where page 1 stopped, and the order is different on the next
 * visit because the seed is new.
 *
 * Two properties make this correct:
 *   1. the shuffle is a pure function of (seed, input order) — same in, same out;
 *   2. the pool is fetched with a total order (the sort key plus a unique
 *      tiebreaker), so "input order" is genuinely identical across requests.
 * Without (2), two clips with equal `rank` could swap places between calls and
 * the permutation would shift underneath the pagination.
 */

/** xmur3 — string to a well-mixed 32-bit seed. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 — small, fast, good enough for arranging a feed. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates over a copy of `items`, driven by `seed`.
 *
 * Returns a new array; the caller's array is never reordered. With an empty or
 * missing seed it returns a copy in the original order, so "unshuffled" is the
 * degenerate case rather than a special code path.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  if (!seed) return out;

  const rand = mulberry32(xmur3(seed)());

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** A fresh per-session seed. Not cryptographic — it only has to differ per visit. */
export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

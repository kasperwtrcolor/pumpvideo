"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { AccountResponse, FeedItemDTO, FeedResponse, QuoteDTO, QuotesResponse } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { useAuth } from "./AuthBridge";
import { BuySheet } from "./BuySheet";
import { CommentSheet } from "./CommentSheet";
import { ShareSheet } from "./ShareSheet";
import { DeleteClipSheet } from "./DeleteClipSheet";
import { fmtCount, fmtPct, fmtPrice, fmtSol, fmtUsd, shortAddr, sym, timeAgo } from "@/lib/format";
import { artUrl } from "@/lib/art-url";
import { newSeed } from "@/lib/shuffle";
import { CoinAvatar } from "./CoinAvatar";
import { AnimatedNumber } from "./AnimatedNumber";
import { getUnread, subscribeUnread } from "@/lib/unread";
import { getWelcomeOpen, setWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { CommentIcon, HeartIcon, PlusIcon, ShareIcon, ShuffleIcon, StarIcon, VolumeIcon } from "./Icons";
import { LiveDot, Sparkline } from "./PriceTicker";

type Sort = "hot" | "new" | "top";
type Scope = "all" | "following";

const SORTS: { key: Sort; label: string; hint: string }[] = [
  // The hint is what the rail *means*, since a one-word label can't carry it.
  // Hot is a gainers board, not "popular"; New is new *tokens*, not new clips;
  // Top is a market-cap floor, not "best".
  { key: "hot", label: "Hot", hint: "biggest 5-minute increase" },
  { key: "new", label: "New", hint: "tokens launched in the last 30 minutes" },
  { key: "top", label: "Top", hint: "market cap $100k and above" },
];

/**
 * The two walls.
 *
 * "For You" is the global ranked feed; "Following" is only the viewer's social
 * graph — clips by people they follow, and every clip on a coin they follow.
 * This is the arrangement every clip feed uses, and it is a switch rather than
 * a filter buried in a menu because it is the thing people flip most.
 */
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "For You" },
  { key: "following", label: "Following" },
];

/** How many clips a signed-out visitor watches between each login invite. */
const WATCH_BEFORE_PROMPT = 5;

/** Session key holding this visit's shuffle seed. */
const SEED_KEY = "pumpclip_seed";

/**
 * Session key holding the moment this visit's feed pool was frozen.
 *
 * The seed pins the *order* of the pool, not the *contents* of it. The catalog
 * grows continuously — fresh tokens are ingested every few minutes — and the
 * shuffle runs over the whole list, so one new clip landing mid-session
 * re-permutes everything and page 2 can repeat what page 1 already showed. That
 * is precisely the repeat-clips bug the seeded shuffle exists to prevent.
 * Filtering the pool to clips that already existed when the session started
 * makes the permutation stable for as long as the visit lasts.
 */
const SINCE_KEY = "pumpclip_since";

/** Live engagement numbers for one clip, seeded from the feed and then updated
 *  from whatever the server reports after each action. */
type Counts = { likes: number; shares: number; comments: number; views: number };

const countsOf = (it: FeedItemDTO): Counts => ({
  likes: it.likes,
  shares: it.shares,
  comments: it.comments,
  views: it.views,
});

export function Feed({
  initialSolUsd,
  mint,
  tokenSymbol,
  focusClipId,
  autoShare,
}: {
  initialSolUsd: number;
  /**
   * When set, the wall is a single token's clips rather than a rail into the
   * catalogue. The scope and sort controls disappear — there is nothing to
   * scope or sort — and the clips run newest-first (see the feed API).
   */
  mint?: string;
  /** The token's ticker, for the compact header, before the first page lands. */
  tokenSymbol?: string;
  /** A clip to open on, for a deep link. */
  focusClipId?: string;
  /** Open the share sheet on arrival — the "you just published this" flow. */
  autoShare?: boolean;
}) {
  const { toast, refresh, trader } = useTrader();
  const { enabled: authEnabled, authenticated, login, getToken } = useAuth();

  /** A single-token wall, not a rail. */
  const single = Boolean(mint);

  /**
   * New is the default wall.
   *
   * The app opens on the newest tokens rather than on Hot: Hot is a gainers
   * board and is empty whenever nothing has moved in the last five minutes, so
   * opening on it made the front page look broken on a quiet day. "What just
   * launched" always has an answer.
   */
  const [sort, setSort] = useState<Sort>("new");
  // The shuffle seed. Null until after mount: sessionStorage does not exist
  // during the server render, so it cannot be read in a useState initialiser.
  const [seed, setSeed] = useState<string | null>(null);

  /** Epoch-ms cutoff of this visit's feed pool, minted with the seed. */
  const [since, setSince] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);

  /** Bumped per reshuffle so the icon's spin replays. */
  const [shuffleSpin, setShuffleSpin] = useState(0);

  /** Which wall: everyone, or just the people and coins this viewer follows. */
  const [scope, setScope] = useState<Scope>("all");
  // Login reminder. `watched` counts distinct clips actually played this session.
  const [watched, setWatched] = useState(0);
  /** The clip-count milestone the welcome screen was last reopened on. */
  const welcomedFor = useRef(0);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [favorited, setFavorited] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const [commentFor, setCommentFor] = useState<FeedItemDTO | null>(null);
  /** The clip whose share sheet is up, if any. */
  const [shareFor, setShareFor] = useState<FeedItemDTO | null>(null);
  /** The viewer's own clip being considered for deletion, if any. */
  const [deleteFor, setDeleteFor] = useState<FeedItemDTO | null>(null);
  const [solUsd, setSolUsd] = useState(initialSolUsd);
  // Live prices from /api/quotes, keyed by mint. Anything absent falls back to
  // the price the feed shipped with.
  const [quotes, setQuotes] = useState<Record<string, QuoteDTO>>({});

  const scroller = useRef<HTMLDivElement>(null);
  // A view is counted once per clip per session — re-scrolling shouldn't inflate it.
  const viewed = useRef<Set<string>>(new Set());
  // Per-mint price history for the sparkline, and "latest value" refs so the
  // poll timer can read what is on screen without being torn down on every
  // scroll and rebuild.
  const history = useRef<Map<string, number[]>>(new Map());
  const itemsRef = useRef<FeedItemDTO[]>([]);
  const activeRef = useRef(0);

  /**
   * Read this session's shuffle seed, minting one on the first visit.
   *
   * Session storage rather than local storage on purpose: the point is that the
   * order is different every time you open the app, not that it is frozen
   * forever. Falling back to an in-memory seed keeps it working when storage is
   * blocked (private mode); the only cost is a fresh order per navigation.
   */
  useEffect(() => {
    // A single-token wall is a fixed body of clips in a fixed order: there is
    // nothing to shuffle, so it skips the session seed (and its pool cutoff)
    // entirely and loads straight away.
    if (single) {
      setSeed("");
      setSince("");
      return;
    }
    let s: string | null = null;
    let t: string | null = null;
    try {
      s = sessionStorage.getItem(SEED_KEY);
      t = sessionStorage.getItem(SINCE_KEY);
    } catch {
      /* storage blocked */
    }
    // Mint both together: a seed without its cutoff is a pool that can still
    // shift underneath the pagination, so half a pair is no better than none.
    if (!s || !t) {
      s = newSeed();
      t = String(Date.now());
      try {
        sessionStorage.setItem(SEED_KEY, s);
        sessionStorage.setItem(SINCE_KEY, t);
      } catch {
        /* storage blocked — the in-memory pair still works */
      }
    }
    setSeed(s);
    setSince(t);
  }, [single]);

  const load = useCallback(
    async (
      nextSort: Sort,
      nextOffset: number,
      nextSeed: string,
      nextSince: string,
      nextScope: Scope,
      replace: boolean,
    ) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          sort: nextSort,
          limit: "10",
          offset: String(nextOffset),
          seed: nextSeed,
          since: nextSince,
          scope: nextScope,
        });
        // Narrows the wall to one token. The API drops its rail gates for a mint
        // request, so what comes back is simply every clip bound to it.
        if (mint) qs.set("mint", mint);
        const r = await fetch(`/api/feed?${qs.toString()}`, { cache: "no-store" });
        const j = (await r.json()) as FeedResponse;
        setSolUsd(j.solUsd || initialSolUsd);
        setItems((prev) => (replace ? j.items : [...prev, ...j.items]));

        // Seed real state from the server rather than assuming everything
        // starts unliked/unsaved and at zero.
        setLiked((prev) => {
          const next = replace ? {} : { ...prev };
          for (const it of j.items) next[it.id] = Boolean(it.likedByMe);
          return next;
        });
        setFavorited((prev) => {
          const next = replace ? {} : { ...prev };
          for (const it of j.items) next[it.id] = Boolean(it.favoritedByMe);
          return next;
        });
        setCounts((prev) => {
          const next = replace ? {} : { ...prev };
          for (const it of j.items) next[it.id] = countsOf(it);
          return next;
        });

        setOffset(j.nextOffset);
        setHasMore(j.hasMore);
      } catch {
        toast("feed failed to load", "bad");
      } finally {
        setLoading(false);
      }
    },
    [initialSolUsd, toast, mint],
  );

  // (Re)load from the top whenever the sort, the seed or the scope changes. A
  // new seed is a fresh permutation and a new scope is a different wall, so in
  // both cases the list has to be rebuilt rather than appended to.
  useEffect(() => {
    // `null` means the seed has not been resolved yet (it is minted after mount,
    // because sessionStorage does not exist during the server render). An empty
    // string is a *resolved* seed with no shuffle — which is exactly what a
    // single-token wall wants, so it must not be treated as "not ready".
    if (seed === null || since === null) return;
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setActive(0);
    scroller.current?.scrollTo({ top: 0 });
    void load(sort, 0, seed, since, scope, true);
  }, [sort, seed, since, scope, load]);

  /** Reshuffle: mint a new seed and start the wall again. */
  const reshuffle = useCallback(() => {
    const s = newSeed();
    // A fresh pool cutoff too: reshuffling is a deliberate restart, so clips
    // ingested since the visit began are fair game again.
    const t = String(Date.now());
    try {
      sessionStorage.setItem(SEED_KEY, s);
      sessionStorage.setItem(SINCE_KEY, t);
    } catch {
      /* storage blocked */
    }
    setSeed(s);
    setSince(t);
    // Replays the icon's spin, so the tap is acknowledged even when the new
    // order happens to look similar.
    setShuffleSpin((n) => n + 1);
    scroller.current?.scrollTo({ top: 0 });
  }, []);

  // Pause everything but the clip in view; preload the neighbours; count a real
  // watch the first time a clip actually plays.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const idx = Number(el.dataset.index);
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            setActive(idx);
            // A clip with no rendered video yet has no <video> to drive — it
            // still counts as watched, otherwise the login nudge would never
            // fire on a wall of freshly ingested tokens.
            const vid = el.querySelector("video");
            if (vid) vid.play().catch(() => {});
            const id = el.dataset.clipId;
            if (id && !viewed.current.has(id)) {
              viewed.current.add(id);
              void fetch(`/api/clips/${id}/view`, { method: "POST" }).catch(() => {});
              setWatched(viewed.current.size);
            }
          } else {
            const vid = el.querySelector("video");
            if (vid) vid.pause();
          }
        }
      },
      { root, threshold: [0, 0.6, 0.95] },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  // Prefetch the next page a screen before the end.
  useEffect(() => {
    if (seed !== null && since !== null && hasMore && !loading && items.length > 0 && active >= items.length - 3) {
      void load(sort, offset, seed, since, scope, false);
    }
  }, [active, hasMore, loading, items.length, offset, sort, seed, since, scope, load]);

  // Keep the "latest value" refs current so the poll timer below can read them.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  /**
   * Open on a specific clip when arriving from a deep link.
   *
   * Two flows use this: a shared link that names the clip, and the
   * just-published flow, where the uploader is dropped onto their own new clip
   * with the share sheet already up. It fires once — later pages just append.
   */
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !focusClipId || items.length === 0) return;
    const idx = items.findIndex((it) => it.id === focusClipId);
    // Not on the first page. The wall is ordered newest-first, so a just-posted
    // clip is always index 0; anything deeper was shared long ago and the viewer
    // can swipe to it. Leaving the wall at the top beats scrolling to a guess.
    if (idx < 0) return;
    deepLinked.current = true;
    setActive(idx);
    const el = scroller.current?.querySelector(`[data-index="${idx}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "start" });
    if (autoShare) setShareFor(items[idx]);
  }, [focusClipId, autoShare, items]);

  // Bumped on every quotes refresh so the sparkline redraws with the new samples.
  const [tick, setTick] = useState(0);

  /**
   * Refresh the live prices for the clips around the viewport.
   *
   * The feed used to render whatever the market keeper had last written and then
   * never change until a reload — which is exactly why the numbers looked
   * frozen. Asking only about the clips near the screen keeps the request small
   * (a dozen mints) and the DexScreener call rate low.
   */
  const pollQuotes = useCallback(async () => {
    const list = itemsRef.current;
    if (list.length === 0) return;
    const from = Math.max(0, activeRef.current - 2);
    const to = Math.min(list.length, activeRef.current + 4);
    const mints = Array.from(new Set(list.slice(from, to).map((it) => it.coin.mint)));
    if (mints.length === 0) return;
    try {
      const r = await fetch(`/api/quotes?mints=${encodeURIComponent(mints.join(","))}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as QuotesResponse;
      if (!j.quotes) return;
      setQuotes((q) => ({ ...q, ...j.quotes }));
      for (const [mint, qt] of Object.entries(j.quotes)) {
        const arr = history.current.get(mint) ?? [];
        arr.push(qt.priceSol);
        if (arr.length > 48) arr.splice(0, arr.length - 48);
        history.current.set(mint, arr);
      }
      setTick((t) => t + 1);
    } catch {
      /* offline — keep the last known prices on screen rather than blank them */
    }
  }, []);

  useEffect(() => {
    void pollQuotes();
    const t = setInterval(() => void pollQuotes(), 12_000);
    return () => clearInterval(t);
  }, [pollQuotes]);

  // Start the ticker the moment a page of clips lands.
  useEffect(() => {
    if (items.length > 0) void pollQuotes();
  }, [items.length, pollQuotes]);

  /**
   * Re-read the caller's book and fold it into the clips on screen.
   *
   * The feed payload already carries positions, but a fill happens *after* it
   * loaded — so without this the clip you just bought would still show as
   * unheld until a reload. /api/account is the same source the portfolio uses.
   */
  const syncPositions = useCallback(async () => {
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as AccountResponse;
      const byMint = new Map((j.positions ?? []).map((p) => [p.mint, p]));
      setItems((prev) =>
        prev.map((it) => {
          const p = byMint.get(it.coin.mint);
          return {
            ...it,
            position: p
              ? {
                  tokens: p.tokens,
                  costSol: p.costSol,
                  entrySol: p.tokens > 0 ? p.costSol / p.tokens : 0,
                  valueSol: p.valueSol,
                  pnlSol: p.pnlSol,
                  pnlPct: p.pnlPct,
                }
              : null,
          };
        }),
      );
    } catch {
      /* offline is fine — the rows keep their previous position state */
    }
  }, []);

  const onFilled = useCallback(
    (idx: number, priceSol: number) => {
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, coin: { ...it.coin, priceSol } } : it)),
      );
      void refresh();
      // The clip we just bought now has a position — attach it without waiting
      // for a reload.
      void syncPositions();
      void pollQuotes();
    },
    [refresh, syncPositions, pollQuotes],
  );

  const onLike = useCallback(
    async (it: FeedItemDTO) => {
      if (!authenticated) {
        toast("Log in to like clips", "bad");
        login();
        return;
      }
      try {
        const token = await getToken();
        if (!token) throw new Error("session expired — log in again");
        const r = await fetch(`/api/clips/${it.id}/like`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await r.json()) as { detail?: string; error?: string; liked?: boolean; likes?: number };
        if (!r.ok) throw new Error(j.detail || j.error || "could not like that");
        setLiked((l) => ({ ...l, [it.id]: Boolean(j.liked) }));
        setCounts((c) => ({
          ...c,
          [it.id]: { ...(c[it.id] ?? countsOf(it)), likes: j.likes ?? 0 },
        }));
      } catch (e) {
        toast((e as Error).message, "bad");
      }
    },
    [authenticated, getToken, login, toast],
  );

  /**
   * Save / unsave. Optimistic, because this is the one action where waiting on a
   * round trip feels broken: the star has to fill under the thumb.
   */
  const onFavorite = useCallback(
    async (it: FeedItemDTO) => {
      if (!authenticated) {
        toast("Log in to save clips", "bad");
        login();
        return;
      }
      const next = !favorited[it.id];
      setFavorited((f) => ({ ...f, [it.id]: next }));
      try {
        const token = await getToken();
        if (!token) throw new Error("session expired — log in again");
        const r = await fetch(`/api/clips/${it.id}/favorite`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await r.json()) as { detail?: string; error?: string; favorited?: boolean };
        if (!r.ok) throw new Error(j.detail || j.error || "could not save that");
        // Trust the server's answer, not the guess we already showed.
        setFavorited((f) => ({ ...f, [it.id]: Boolean(j.favorited) }));
        toast(j.favorited ? "saved to favourites" : "removed from favourites");
      } catch (e) {
        setFavorited((f) => ({ ...f, [it.id]: !next })); // roll back
        toast((e as Error).message, "bad");
      }
    },
    [authenticated, favorited, getToken, login, toast],
  );

  // Sharing is no longer a side effect of this component: it used to fire the
  // native sheet (or copy a link) directly, which gave the app no room to offer
  // its own destinations or to show where the link pointed. It now opens
  // <ShareSheet>, which owns the destinations, the count, and the deep link.

  /**
   * Reopen the welcome screen at the watch milestone.
   *
   * This replaces the old login modal. A signed-out viewer who keeps swiping is
   * asked to log in every WATCH_BEFORE_PROMPT clips — but by *showing the
   * welcome screen again*, not by interrupting with a dialog, so the ask is the
   * same screen the app opens with and the copy never has to talk about counts.
   *
   * `welcomedFor` is what keeps it to once per milestone. Without it the effect
   * would re-fire on every unrelated re-render while `watched` sat on a
   * multiple, and a viewer who dismissed and carried on would be trapped behind
   * an overlay that kept springing back.
   */
  useEffect(() => {
    if (!authEnabled || authenticated) return;
    if (watched === 0 || watched % WATCH_BEFORE_PROMPT !== 0) return;
    if (welcomedFor.current === watched) return;
    welcomedFor.current = watched;
    setWelcomeOpen(true);
  }, [watched, authEnabled, authenticated]);

  // Subscribe so the feed knows to stand the video down while the welcome
  // screen is up. Pausing is the point: the overlay is opaque, so a clip
  // playing audio behind it is a sound with no picture.
  const welcomeOpen = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    if (welcomeOpen) {
      root.querySelectorAll("video").forEach((v) => v.pause());
      return;
    }
    // Back to the feed: whatever is on screen should be playing again. The
    // observer will not re-fire for a slide that never moved.
    const vid = root.querySelector(`[data-index="${activeRef.current}"] video`);
    if (vid instanceof HTMLVideoElement) vid.play().catch(() => {});
  }, [welcomeOpen]);

  return (
    <div className="relative h-full">
      {/* A single token has no rail — no scope, no sort, nothing to reshuffle —
          so its chrome is just a way back and the token's own name. */}
      {single && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center gap-2 p-3">
          <Link
            href="/coins"
            className="pointer-events-auto rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[12px] font-bold text-white backdrop-blur"
          >
            ← coins
          </Link>
          <span className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[12px] font-black text-white backdrop-blur">
            ${sym(tokenSymbol ?? items[0]?.coin.symbol ?? "")}
          </span>
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
            className="pointer-events-auto ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur"
          >
            <VolumeIcon muted={muted} className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* sort rail — sits below the transparent header overlay, which the feed
          renders underneath so the video runs to the top edge of the screen. */}
      {!single && (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col items-center gap-2 pt-[calc(env(safe-area-inset-top)+5rem)]">
        {/* Which wall. Centred at the top, the way every clip feed does it. */}
        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              className={`rounded-full px-3.5 py-1 text-[12px] font-black transition ${
                scope === s.key ? "bg-ink text-black" : "text-white/70 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              title={s.hint}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                sort === s.key ? "bg-ink text-black" : "text-white/70 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={reshuffle}
            title="reshuffle the wall"
            aria-label="Reshuffle"
            className="flex items-center rounded-full px-2.5 py-1 text-white/70 transition hover:text-white"
          >
            <ShuffleIcon
              key={`sh-${shuffleSpin}`}
              className={`h-3.5 w-3.5 ${shuffleSpin > 0 ? "spin-once" : ""}`}
            />
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            title="toggle sound"
            aria-label={muted ? "Unmute" : "Mute"}
            className="flex items-center rounded-full px-2.5 py-1 text-white/70 transition hover:text-white"
          >
            <VolumeIcon muted={muted} className="h-3.5 w-3.5" />
          </button>
        </div>

        <NotificationBanner />
      </div>
      )}

      <div ref={scroller} className="snap-feed no-scrollbar h-full overflow-y-scroll">
        {items.map((it, i) => (
          <ClipPanel
            key={it.id}
            item={it}
            index={i}
            isActive={active === i}
            muted={muted}
            liked={Boolean(liked[it.id])}
            favorited={Boolean(favorited[it.id])}
            counts={counts[it.id] ?? countsOf(it)}
            solUsd={solUsd}
            quote={quotes[it.coin.mint]}
            samples={history.current.get(it.coin.mint) ?? []}
            tick={tick}
            onLike={() => void onLike(it)}
            onFavorite={() => void onFavorite(it)}
            onBuy={() => setSheetIdx(i)}
            onShare={() => setShareFor(it)}
            onComment={() => setCommentFor(it)}
            // Only the creator can offer deletion, and only for a clip they
            // really own. The server re-checks; this just keeps the control off
            // everyone else's screen.
            isOwner={Boolean(trader?.id && it.creatorId && it.creatorId === trader.id)}
            onDelete={() => setDeleteFor(it)}
          />
        ))}

        {items.length === 0 && seed !== null && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            {scope === "following" ? (
              authEnabled && !authenticated ? (
                <>
                  <p className="text-lg font-bold">Your following feed</p>
                  <p className="text-xs text-muted">
                    Log in to follow people and tokens, and their clips show up here.
                  </p>
                  <button
                    onClick={login}
                    className="press rounded-xl burn-gradient px-5 py-2.5 text-[12px] font-black text-black"
                  >
                    Log in
                  </button>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold">Nothing here yet.</p>
                  <p className="text-xs text-muted">
                    You are not following anyone. Follow a creator or a token and their clips
                    land on this wall.
                  </p>
                  <Link
                    href="/search"
                    className="press rounded-xl burn-gradient px-5 py-2.5 text-[12px] font-black text-black"
                  >
                    Find people and tokens
                  </Link>
                </>
              )
            ) : single ? (
              <>
                <p className="text-lg font-bold">No clips for ${sym(tokenSymbol ?? "")} yet.</p>
                <p className="text-xs text-muted">Be the first to clip it.</p>
                <Link
                  href={`/upload?token=${encodeURIComponent(mint ?? "")}`}
                  className="press rounded-xl burn-gradient px-5 py-2.5 text-[12px] font-black text-black"
                >
                  Upload a clip
                </Link>
              </>
            ) : (
              <>
                <p className="text-lg font-bold">Nothing on the wall yet.</p>
                <p className="text-xs text-muted">
                  Upload a clip and bind it to a token to get the feed started.
                </p>
              </>
            )}
          </div>
        )}

        {items.length === 0 && loading && <ClipSkeleton />}

        {items.length > 0 && loading && (
          <div className="flex h-24 items-center justify-center text-xs text-muted">loading…</div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="flex h-24 items-center justify-center text-xs text-muted">
            end of the wall · {items.length} clips
          </div>
        )}
      </div>

      {sheetIdx !== null && items[sheetIdx] && (
        <BuySheet
          coin={items[sheetIdx].coin}
          clipId={items[sheetIdx].id}
          open
          onClose={() => setSheetIdx(null)}
          onFilled={({ priceSol }) => onFilled(sheetIdx, priceSol)}
        />
      )}

      {shareFor && (
        <ShareSheet
          clipId={shareFor.id}
          mint={shareFor.coin.mint}
          symbol={shareFor.coin.symbol}
          caption={shareFor.caption}
          videoUrl={shareFor.videoUrl}
          open
          onClose={() => setShareFor(null)}
          onCount={(n) =>
            setCounts((c) => ({
              ...c,
              [shareFor.id]: { ...(c[shareFor.id] ?? countsOf(shareFor)), shares: n },
            }))
          }
        />
      )}

      {deleteFor && (
        <DeleteClipSheet
          clipId={deleteFor.id}
          symbol={deleteFor.coin.symbol}
          open
          onClose={() => setDeleteFor(null)}
          onDeleted={() => {
            // Drop it from the wall immediately. Re-fetching would also work but
            // would briefly show the clip the user just killed, which reads as
            // the delete having failed.
            const gone = deleteFor.id;
            setItems((prev) => prev.filter((x) => x.id !== gone));
            setDeleteFor(null);
          }}
        />
      )}

      {commentFor && (
        <CommentSheet
          clipId={commentFor.id}
          symbol={commentFor.coin.symbol}
          open
          onClose={() => setCommentFor(null)}
          onCount={(n) =>
            setCounts((c) => ({
              ...c,
              [commentFor.id]: { ...(c[commentFor.id] ?? countsOf(commentFor)), comments: n },
            }))
          }
        />
      )}
    </div>
  );
}

function ClipPanel({
  item,
  index,
  isActive,
  muted,
  liked,
  favorited,
  counts,
  solUsd,
  quote,
  samples,
  tick,
  onLike,
  onFavorite,
  onBuy,
  onShare,
  onComment,
  isOwner,
  onDelete,
}: {
  item: FeedItemDTO;
  index: number;
  /** True while this is the panel under the viewer — drives the arrival motion. */
  isActive: boolean;
  muted: boolean;
  liked: boolean;
  favorited: boolean;
  counts: Counts;
  solUsd: number;
  quote?: QuoteDTO;
  samples: number[];
  tick: number;
  onLike: () => void;
  onFavorite: () => void;
  onBuy: () => void;
  onShare: () => void;
  onComment: () => void;
  /** True when the viewer uploaded this clip — the only case deletion is shown. */
  isOwner: boolean;
  onDelete: () => void;
}) {
  const { coin } = item;
  const vid = useRef<HTMLVideoElement>(null);

  /**
   * How many times this panel has arrived under the viewer.
   *
   * A counter rather than a boolean, because both the bounce and the price count
   * are keyed on it: a panel that is swiped away from and back to should play
   * again, and one that merely re-renders (a quote landing, a like) should not.
   * Zero means it has never been the active panel, so nothing plays on the
   * initial paint of panels the viewer has not reached yet.
   */
  const [arrival, setArrival] = useState(0);
  useEffect(() => {
    if (isActive) setArrival((n) => n + 1);
  }, [isActive]);

  /**
   * Replays the entrance every time this panel arrives under the viewer.
   *
   * The class is removed and re-added a frame later rather than keying the
   * element: a `key` would remount everything inside the block, and the price
   * counter in there has to stay mounted or it loses the value it counts from.
   */
  const bounce = useArrival(isActive);

  // The burst counters replay an acknowledgement animation exactly on the
  // transition to the on-state — not when a clip arrives already liked/saved,
  // which would animate on render rather than on the user's tap.
  const burst = useOnTrue(liked);
  const savePop = useOnTrue(favorited);

  /**
   * Double-tap to like.
   *
   * Every clip feed anyone has used behaves this way, so its absence reads as
   * the app being unfinished. The big heart is local and purely decorative: it
   * plays whether or not the like is accepted, so a signed-out double-tap still
   * gets the acknowledgement and then the login toast explains why.
   */
  const [bigHeart, setBigHeart] = useState(0);
  const lastTap = useRef(0);
  const tapMedia = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      setBigHeart((n) => n + 1);
      if (!liked) onLike();
      return;
    }
    lastTap.current = now;
  }, [liked, onLike]);

  // Taps that land on a control are that control's business — the rail sits
  // inside this section, so without the guard a "like" tap would also count as
  // the first tap of a double-tap. Links are included: the "clip this token"
  // action is an anchor, and without it a tap would both navigate and register
  // a media tap on the way out.
  const onSectionClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      tapMedia();
    },
    [tapMedia],
  );

  // Live values win over the ones the feed shipped with; until the first quote
  // lands, the shipped price is what is shown.
  const price = quote?.priceSol ?? coin.priceSol;
  const marketCap = quote?.marketCapSol ?? coin.marketCapSol;
  const change = quote?.change24hPct ?? coin.change24hPct;
  /**
   * Where this price stood 24 hours ago, implied by the reported change.
   *
   * The price chip counts up from here (or down to it) each time the clip
   * arrives under the viewer, so the direction of the day is something the eye
   * catches rather than something that has to be read. Deriving the start from
   * the coin's own change means the count is a real movement, not a decoration —
   * a coin up 50% counts up from two-thirds of its price, and one down 50%
   * counts down from double it.
   */
  const priorPrice = change > -99.9 ? price / (1 + change / 100) : price;

  // Token age. pump.fun tells us when a coin launched; when it doesn't, the
  // moment it entered our catalogue is the honest fallback — it is still "how
  // long this token has been around" from the viewer's side of the screen.
  const age = timeAgo(coin.launchedAt ?? coin.createdAt);
  // The 5-minute move, the same number the Hot rail ranks on. Signed, so a dump
  // reads as clearly as a pump.
  const change5m = coin.change5mPct ?? 0;

  // The trader's own position, if any. When they hold, the price is coloured
  // against *their entry* — above it green, below it red — instead of the
  // generic 24h move. That is the number they actually care about.
  const pos = item.position ?? null;
  const livePnlPct = pos && pos.entrySol > 0 ? ((price - pos.entrySol) / pos.entrySol) * 100 : null;
  const livePnlSol = pos ? pos.tokens * price - pos.costSol : 0;
  const inProfit = pos ? price >= pos.entrySol : change >= 0;

  // Flash the price chip for a moment whenever it moves, so a tick is visible
  // even when the digits change by too little to notice.
  const prevPrice = useRef(price);
  const [flash, setFlash] = useState<"" | "tick-up" | "tick-down">("");
  useEffect(() => {
    const prev = prevPrice.current;
    prevPrice.current = price;
    if (!Number.isFinite(prev) || prev <= 0 || price === prev) return;
    setFlash(price > prev ? "tick-up" : "tick-down");
    const t = setTimeout(() => setFlash(""), 700);
    return () => clearTimeout(t);
  }, [price]);

  useEffect(() => {
    if (vid.current) vid.current.muted = muted;
  }, [muted]);

  // A clip with no rendered video shows the coin's art instead. That is the
  // normal state for a token the ingester picked up minutes ago — the art is
  // what the coin actually looks like, so it is honest, and drifting it keeps
  // the panel from reading as a broken clip. Prefer the stored thumb; fall back
  // to the coin art through the gateway chain.
  const stillUrl = item.thumbUrl ?? artUrl(coin.imageUrl);
  const hasVideo = Boolean(item.videoUrl);

  return (
    <section
      data-index={index}
      data-clip-id={item.id}
      onClick={onSectionClick}
      className="snap-item clip-enter relative h-full w-full overflow-hidden bg-black"
    >
      {hasVideo ? (
        <>
          {/* thumbnail sits underneath so the panel is never blank while the file loads */}
          {stillUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stillUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-60"
            />
          )}

          <video
            ref={vid}
            src={item.videoUrl ?? undefined}
            poster={stillUrl ?? undefined}
            loop
            muted
            playsInline
            preload={index < 3 ? "auto" : "metadata"}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </>
      ) : (
        <>
          {stillUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stillUrl}
              alt=""
              className="kenburns absolute inset-0 h-full w-full object-cover"
            />
          )}
          {/* Labelled, not hidden: a buyer should know they are looking at art and
              not a clip. It is a new token, not a broken one. */}
          <span className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/80 backdrop-blur">
            new token · clip soon
          </span>
        </>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/55" />

      {/* right rail.
          Bottom-anchored and compact on purpose: with five actions plus the
          header icons above it, the column has to clear the header on a short
          viewport (a landscape phone, or a small window). Sizes and gaps are
          kept tight so the top of the rail stays below the chrome. */}
      <div
        className={`absolute bottom-28 right-3 z-30 flex flex-col items-center gap-3 ${
          bounce ? "clip-bounce" : ""
        }`}
        style={bounce ? { animationDelay: "70ms" } : undefined}
      >
        <RailButton
          label={sym(coin.symbol).slice(0, 5)}
          sub="coin"
          art={coin.imageUrl}
          symbol={coin.symbol}
          onClick={onBuy}
          ring
        />
        <RailButton
          label={<RollingCount value={fmtCount(counts.likes)} />}
          sub="like"
          onClick={onLike}
          active={liked}
        >
          <LikeGlyph liked={liked} burst={burst} />
        </RailButton>
        <RailButton
          label={<RollingCount value={fmtCount(counts.comments)} />}
          sub="comment"
          onClick={onComment}
        >
          <CommentIcon className="h-8 w-8 text-white" />
        </RailButton>
        <RailButton
          label={<RollingCount value={fmtCount(counts.shares)} />}
          sub="share"
          onClick={onShare}
        >
          <ShareIcon className="h-8 w-8 text-white" />
        </RailButton>
        <RailButton label={favorited ? "saved" : "save"} sub="later" onClick={onFavorite}>
          <StarIcon
            key={`s-${savePop}`}
            className={`h-8 w-8 ${favorited ? "text-accent" : "text-white"} ${
              favorited && savePop > 0 ? "star-pop" : ""
            }`}
            filled={favorited}
          />
        </RailButton>
      </div>

      {/* The double-tap heart. Keyed on its counter so each double-tap replays
          it; purely decorative, so it is never allowed to block a tap. */}
      {bigHeart > 0 && (
        <span
          key={`bh-${bigHeart}`}
          className="big-heart pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
        >
          <HeartIcon filled className="h-28 w-28 text-down drop-shadow-[0_6px_28px_rgba(0,0,0,0.65)]" />
        </span>
      )}

      {/* bottom info */}
      <div
        className={`absolute inset-x-0 bottom-0 z-30 space-y-3 p-4 pr-20 ${
          bounce ? "clip-bounce" : ""
        }`}
      >
        <div className="flex items-center gap-2 text-[13px] text-white/90 text-glow">
          {item.creatorId ? (
            <Link
              href={`/u/${encodeURIComponent(item.creatorId)}`}
              className="press font-bold underline decoration-white/30 underline-offset-2"
            >
              @{item.author ?? "creator"}
            </Link>
          ) : (
            <span className="font-bold">@{item.author ?? "unclaimed"}</span>
          )}
          {item.source === "UPLOAD" && (
            <span className="rounded bg-accent/25 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-accent">
              CREATOR
            </span>
          )}
          <span className="text-white/50">·</span>
          <span className="text-white/60">{fmtCount(counts.views)} views</span>
          {/* Deleting your own clip. Kept to a quiet glyph on the author line —
              it belongs to the poster and should be invisible to everyone else,
              not a loud button shouting at a viewer who cannot use it. */}
          {isOwner && (
            <button
              onClick={onDelete}
              aria-label="Delete this clip"
              title="Delete this clip"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="5" cy="12" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="19" cy="12" r="1.4" />
              </svg>
            </button>
          )}
        </div>

        <p className="line-clamp-2 text-[15px] font-medium text-white/95 text-glow">
          {item.caption ?? `$${sym(coin.symbol)}`}
        </p>

        {/* Live sparkline — what the price has done while you have been watching.
            Keyed on the poll counter so it redraws with each new sample. */}
        {samples.length > 1 && (
          <div className="max-w-[210px]">
            <Sparkline key={tick} samples={samples} />
          </div>
        )}

        {/* The trader's own line, when they hold this coin: everything above the
            entry price is green, everything below is red. */}
        {pos && (
          <div
            className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums ${
              inProfit ? "bg-up/20 text-up" : "bg-down/20 text-down"
            }`}
          >
            <span>
              you · {fmtSol(pos.tokens)} ${sym(coin.symbol)}
            </span>
            <span className="font-semibold opacity-80">entry {fmtPrice(pos.entrySol)}</span>
            <span className="font-black">
              {livePnlPct != null ? fmtPct(livePnlPct) : "—"}
            </span>
            <span className="font-semibold opacity-90">
              {livePnlSol >= 0 ? "+" : ""}
              {fmtSol(livePnlSol)} SOL
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-black tracking-wide text-white">
            ${sym(coin.symbol)}
          </span>
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${
              change >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down"
            }`}
          >
            24h{" "}
            <AnimatedNumber
              value={change}
              from={0}
              replayKey={`chg-${arrival}`}
              format={(n) => fmtPct(n)}
            />
          </span>
          {/* The 5-minute move — the number the Hot rail is ranked on, so a
              viewer can see *why* a clip surfaced as hot. Hidden at a flat zero
              (a coin the keeper has not measured yet) rather than printing a
              meaningless "0.0%". */}
          {change5m !== 0 && (
            <span
              className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${
                change5m >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down"
              }`}
            >
              5m {fmtPct(change5m)}
            </span>
          )}
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            MC {fmtSol(marketCap)} SOL · {fmtUsd(marketCap * solUsd)}
          </span>
          {/* How old the token is — launch time when pump.fun gave us one, else
              the moment it entered the catalogue. */}
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            {age} old
          </span>
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${flash} ${
              inProfit ? "text-up" : "text-down"
            }`}
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          >
            <AnimatedNumber
              value={price}
              from={priorPrice}
              replayKey={`px-${arrival}`}
              format={(n) => `${fmtPrice(n)} SOL`}
            />
            <LiveDot live={Boolean(quote?.live)} />
          </span>
          {coin.complete && (
            <span className="rounded-md bg-accent/25 px-2 py-1 text-[11px] font-bold text-accent">
              graduated
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onBuy}
            className="burn-gradient flex-1 rounded-xl py-3 text-sm font-black tracking-wide text-black active:scale-[0.99]"
          >
            buy ${sym(coin.symbol)}
          </button>
          {/* Make your own clip for *this* token.
              The hard part of posting used to be finding the mint of the coin
              you were looking at and pasting it into the upload form. From here
              the address is carried in the URL, so the form arrives with the
              token already bound and the video is the only decision left. */}
          <Link
            href={`/upload?token=${encodeURIComponent(coin.mint)}`}
            title={`Upload a clip for $${sym(coin.symbol)}`}
            aria-label={`Upload a clip for $${sym(coin.symbol)}`}
            className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-black/45 px-3 py-3 text-[11px] font-bold text-white/85 active:scale-[0.98]"
          >
            <PlusIcon className="h-4 w-4" />
            clip
          </Link>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(coin.mint);
            }}
            title={coin.mint}
            className="rounded-xl border border-white/20 bg-black/45 px-3 py-3 text-[11px] font-semibold text-white/80"
          >
            {shortAddr(coin.mint, 3)}
          </button>
        </div>
      </div>
    </section>
  );
}

function RailButton({
  label,
  sub,
  icon,
  art,
  symbol,
  onClick,
  active,
  ring,
  children,
}: {
  label: ReactNode;
  sub: string;
  icon?: string;
  art?: string | null;
  symbol?: string;
  onClick?: () => void;
  active?: boolean;
  ring?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex flex-col items-center gap-0.5 text-white"
    >
      {children ? (
        children
      ) : art ? (
        <CoinAvatar
          src={art}
          symbol={symbol ?? (typeof label === "string" ? label : "")}
          className={`h-11 w-11 rounded-full ${ring ? "" : "border border-white/40"}`}
          ring={ring}
        />
      ) : (
        <span className={`text-2xl ${active ? "text-down" : ""}`}>{icon}</span>
      )}
      <span className="text-[10px] font-bold text-glow">{label}</span>
      <span className="text-[9px] uppercase tracking-wider text-white/50">{sub}</span>
    </button>
  );
}

/** Eight evenly-spaced directions for the like burst. */
const PARTICLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A counter that ticks each time `flag` flips to true.
 *
 * Used as a React key so the acknowledgement animation replays on exactly the
 * transition a user caused — and never on a re-render, a poll-driven refresh, or
 * a clip arriving already in that state.
 */
function useOnTrue(flag: boolean): number {
  const [n, setN] = useState(0);
  const prev = useRef(flag);
  useEffect(() => {
    if (flag && !prev.current) setN((x) => x + 1);
    prev.current = flag;
  }, [flag]);
  return n;
}

/**
 * The like glyph and its burst.
 *
 * The burst is keyed on `burst` so it remounts — and so replays — exactly once
 * per tap. It deliberately does *not* fire when a clip arrives already-liked:
 * an animation that runs on render rather than on interaction is noise, and the
 * whole point of motion here is to acknowledge the tap.
 */
function LikeGlyph({ liked, burst }: { liked: boolean; burst: number }) {
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center">
      {liked && burst > 0 && (
        <>
          <span
            key={`ring-${burst}`}
            className="heart-ring pointer-events-none absolute inset-0 rounded-full border-2 border-down"
          />
          <span key={`p-${burst}`} className="pointer-events-none absolute inset-0">
            {PARTICLES.map((a) => (
              <span
                key={a}
                className="particle-fly absolute left-1/2 top-1/2 -ml-0.5 -mt-0.5 h-1 w-1 rounded-full bg-down"
                style={{ "--a": `${a}deg` } as CSSProperties}
              />
            ))}
          </span>
        </>
      )}
      <HeartIcon
        key={`h-${burst}`}
        filled={liked}
        className={`relative h-7 w-7 ${liked ? "heart-pop text-down" : "text-white"}`}
      />
    </span>
  );
}

/**
 * Replays an entrance animation when `isActive` turns true.
 *
 * Returns a flag to toggle a class with. It is deliberately *not* a `key`: the
 * blocks that bounce contain the price counter, and remounting them would reset
 * the counter's start value, turning the count into a snap. Setting the flag
 * false and then true again on the next frame is what makes the browser treat
 * it as a new animation.
 */
function useArrival(isActive: boolean): boolean {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    setPlay(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPlay(true));
    });
    const done = setTimeout(() => setPlay(false), 760);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      clearTimeout(done);
    };
  }, [isActive]);

  return play;
}

/**
 * The green "there is something waiting for you" pill.
 *
 * Styled after the notification banners these apps put over the feed: a solid
 * accent fill rather than a subtle chip, because the whole job is to interrupt a
 * viewer who is mid-scroll. It reads the unread count from the shared store the
 * bell already polls, so it costs no extra request and the two can never
 * disagree.
 *
 * Dismissal is per session and recorded the moment it is tapped: the tap goes to
 * the inbox, and offering it again a second later — while the count is on its
 * way to zero — would be nagging.
 */
function NotificationBanner() {
  const unread = useSyncExternalStore(subscribeUnread, getUnread, () => 0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("pogo_notif_banner") === "1") setHidden(true);
    } catch {
      /* storage blocked — worst case it shows again next visit */
    }
  }, []);

  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      sessionStorage.setItem("pogo_notif_banner", "1");
    } catch {
      /* ignore */
    }
  }, []);

  if (unread <= 0 || hidden) return null;

  return (
    <Link
      href="/notifications"
      onClick={dismiss}
      className="banner-drop banner-glow pointer-events-auto flex items-center gap-2 rounded-full bg-accent py-1.5 pl-1.5 pr-4 text-[13px] font-black tracking-tight text-black"
    >
      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-black/85 px-1.5 text-[11px] font-black text-accent tabular-nums">
        {unread > 99 ? "99+" : unread}
      </span>
      {unread === 1 ? "New notification" : "New notifications"}
    </Link>
  );
}

/**
 * A number that animates when it changes.
 *
 * Keyed on its own value, so React remounts this span — and the CSS animation
 * replays — exactly when the number moved, and never on a re-render that left
 * it unchanged. Static text updates are easy to miss (change blindness); a roll
 * is what makes a like count read as having actually gone up. An invisible copy
 * of the value holds the width so the rail does not jump mid-animation.
 */
function RollingCount({ value }: { value: string }) {
  return (
    <span className="relative inline-block overflow-hidden align-bottom">
      <span className="invisible" aria-hidden>
        {value}
      </span>
      <span key={value} className="count-roll absolute inset-0">
        {value}
      </span>
    </span>
  );
}

/**
 * A placeholder clip, shown only while the very first page is in flight.
 *
 * A bare "loading…" leaves the screen black, which reads as a broken app; a
 * shimmered skeleton of the clip that is coming is both the convention users
 * already understand and a way to keep the layout from jumping when the real
 * content lands. It is deliberately a still composition — the rail, the
 * caption block, the buy button — rather than a spinning wheel.
 */
function ClipSkeleton() {
  return (
    <div className="snap-item relative h-full w-full overflow-hidden bg-black">
      <div className="skeleton absolute inset-0 opacity-40" />
      <div className="absolute bottom-36 right-3 flex flex-col items-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-2 w-7 rounded" />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-4 pr-20">
        <div className="skeleton h-3 w-28 rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
        <div className="skeleton h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}

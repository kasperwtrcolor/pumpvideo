"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FeedItemDTO, FeedResponse } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { useAuth } from "./AuthBridge";
import { BuySheet } from "./BuySheet";
import { CommentSheet } from "./CommentSheet";
import { fmtCount, fmtPct, fmtPrice, fmtSol, fmtUsd, shortAddr, sym } from "@/lib/format";
import { artUrl } from "@/lib/art-url";
import { newSeed } from "@/lib/shuffle";
import { CoinAvatar } from "./CoinAvatar";
import { StarIcon } from "./Icons";

type Sort = "hot" | "new" | "top";

const SORTS: { key: Sort; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "top", label: "Top" },
];

/** How many clips a signed-out visitor can watch before we invite them in. */
const WATCH_BEFORE_PROMPT = 5;

/** Session key holding this visit's shuffle seed. */
const SEED_KEY = "pumpclip_seed";

/** Live engagement numbers for one clip, seeded from the feed and then updated
 *  from whatever the server reports after each action. */
type Counts = { likes: number; shares: number; comments: number; views: number };

const countsOf = (it: FeedItemDTO): Counts => ({
  likes: it.likes,
  shares: it.shares,
  comments: it.comments,
  views: it.views,
});

export function Feed({ initialSolUsd }: { initialSolUsd: number }) {
  const { toast, refresh } = useTrader();
  const { enabled: authEnabled, authenticated, login, getToken } = useAuth();

  const [sort, setSort] = useState<Sort>("hot");
  // The shuffle seed. Null until after mount: sessionStorage does not exist
  // during the server render, so it cannot be read in a useState initialiser.
  const [seed, setSeed] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  // Login nudge. `watched` counts distinct clips actually played this session.
  const [watched, setWatched] = useState(0);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [favorited, setFavorited] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const [commentFor, setCommentFor] = useState<FeedItemDTO | null>(null);
  const [solUsd, setSolUsd] = useState(initialSolUsd);

  const scroller = useRef<HTMLDivElement>(null);
  // A view is counted once per clip per session — re-scrolling shouldn't inflate it.
  const viewed = useRef<Set<string>>(new Set());

  /**
   * Read this session's shuffle seed, minting one on the first visit.
   *
   * Session storage rather than local storage on purpose: the point is that the
   * order is different every time you open the app, not that it is frozen
   * forever. Falling back to an in-memory seed keeps it working when storage is
   * blocked (private mode); the only cost is a fresh order per navigation.
   */
  useEffect(() => {
    let s: string | null = null;
    try {
      s = sessionStorage.getItem(SEED_KEY);
    } catch {
      /* storage blocked */
    }
    if (!s) {
      s = newSeed();
      try {
        sessionStorage.setItem(SEED_KEY, s);
      } catch {
        /* storage blocked — the in-memory seed still works */
      }
    }
    setSeed(s);
  }, []);

  const load = useCallback(
    async (nextSort: Sort, nextOffset: number, nextSeed: string, replace: boolean) => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/feed?sort=${nextSort}&limit=10&offset=${nextOffset}&seed=${encodeURIComponent(nextSeed)}`,
          { cache: "no-store" },
        );
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
    [initialSolUsd, toast],
  );

  // (Re)load from the top whenever the sort or the seed changes. A new seed is
  // a fresh permutation, so the list has to be rebuilt rather than appended to.
  useEffect(() => {
    if (!seed) return;
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setActive(0);
    void load(sort, 0, seed, true);
  }, [sort, seed, load]);

  /** Reshuffle: mint a new seed and start the wall again. */
  const reshuffle = useCallback(() => {
    const s = newSeed();
    try {
      sessionStorage.setItem(SEED_KEY, s);
    } catch {
      /* storage blocked */
    }
    setSeed(s);
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
    if (seed && hasMore && !loading && items.length > 0 && active >= items.length - 3) {
      void load(sort, offset, seed, false);
    }
  }, [active, hasMore, loading, items.length, offset, sort, seed, load]);

  const onFilled = useCallback(
    (idx: number, priceSol: number) => {
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, coin: { ...it.coin, priceSol } } : it)),
      );
      void refresh();
    },
    [refresh],
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

  const onShare = useCallback(
    async (it: FeedItemDTO) => {
      const url = `${window.location.origin}/coin/${it.coin.symbol}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: `$${it.coin.symbol}`, url });
        } else {
          await navigator.clipboard.writeText(url);
          toast("link copied");
        }
      } catch {
        // The user cancelled the share sheet — that is not a share, so it is not
        // counted. Recording it would make the number meaningless.
        return;
      }

      if (!authenticated) return;
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`/api/clips/${it.id}/share`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await r.json()) as { shares?: number };
        if (r.ok && typeof j.shares === "number") {
          setCounts((c) => ({
            ...c,
            [it.id]: { ...(c[it.id] ?? countsOf(it)), shares: j.shares as number },
          }));
        }
      } catch {
        /* the share already happened; a failed count is not worth a toast */
      }
    },
    [authenticated, getToken, toast],
  );

  // Remember a dismissal for the session, so the invite is offered once rather
  // than every time the count crosses the threshold.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("pumpclip_login_nudge") === "1") setNudgeDismissed(true);
    } catch {
      /* storage blocked — worst case the nudge reappears next navigation */
    }
  }, []);

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true);
    try {
      sessionStorage.setItem("pumpclip_login_nudge", "1");
    } catch {
      /* ignore */
    }
  }, []);

  const showLoginNudge =
    authEnabled && !authenticated && !nudgeDismissed && watched >= WATCH_BEFORE_PROMPT;

  return (
    <div className="relative h-full">
      {/* sort rail — sits below the transparent header overlay, which the feed
          renders underneath so the video runs to the top edge of the screen. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center pt-[calc(env(safe-area-inset-top)+3.25rem)]">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
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
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white/70 transition hover:text-white active:rotate-180"
          >
            ⤮
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            title="toggle sound"
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white/70 hover:text-white"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      <div ref={scroller} className="snap-feed no-scrollbar h-full overflow-y-scroll">
        {items.map((it, i) => (
          <ClipPanel
            key={it.id}
            item={it}
            index={i}
            muted={muted}
            liked={Boolean(liked[it.id])}
            favorited={Boolean(favorited[it.id])}
            counts={counts[it.id] ?? countsOf(it)}
            solUsd={solUsd}
            onLike={() => void onLike(it)}
            onFavorite={() => void onFavorite(it)}
            onBuy={() => setSheetIdx(i)}
            onShare={() => void onShare(it)}
            onComment={() => setCommentFor(it)}
          />
        ))}

        {items.length === 0 && seed !== null && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-bold">Nothing on the wall yet.</p>
            <p className="text-xs text-muted">
              Upload a clip and bind it to a token to get the feed started.
            </p>
          </div>
        )}

        {loading && (
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

      {showLoginNudge && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-nudge-title"
          className="fixed inset-0 z-[75] grid place-items-center bg-black/80 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
        >
          <button aria-label="Dismiss" className="absolute inset-0" onClick={dismissNudge} />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-panel p-5 text-center">
            <h2 id="login-nudge-title" className="text-base font-bold tracking-tight">
              Create a wallet to trade
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              That&apos;s {WATCH_BEFORE_PROMPT} clips in. Log in with email, Google or X and a
              self-custodial Solana wallet is created for you — then any clip in the feed is
              one tap to buy.
            </p>
            <button
              onClick={() => {
                dismissNudge();
                login();
              }}
              className="burn-gradient mt-4 w-full rounded-xl py-3 text-sm font-black tracking-wide text-black active:scale-[0.99]"
            >
              Log in
            </button>
            <button
              onClick={dismissNudge}
              className="mt-2 w-full rounded-xl border border-line py-2.5 text-[12px] font-bold text-muted hover:text-ink"
            >
              Keep browsing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClipPanel({
  item,
  index,
  muted,
  liked,
  favorited,
  counts,
  solUsd,
  onLike,
  onFavorite,
  onBuy,
  onShare,
  onComment,
}: {
  item: FeedItemDTO;
  index: number;
  muted: boolean;
  liked: boolean;
  favorited: boolean;
  counts: Counts;
  solUsd: number;
  onLike: () => void;
  onFavorite: () => void;
  onBuy: () => void;
  onShare: () => void;
  onComment: () => void;
}) {
  const { coin } = item;
  const vid = useRef<HTMLVideoElement>(null);
  const up = coin.change24hPct >= 0;

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
      className="snap-item relative h-full w-full overflow-hidden bg-black"
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

      {/* right rail */}
      <div className="absolute bottom-36 right-3 z-30 flex flex-col items-center gap-4">
        <RailButton
          label={sym(coin.symbol).slice(0, 5)}
          sub="coin"
          art={coin.imageUrl}
          symbol={coin.symbol}
          onClick={onBuy}
          ring
        />
        <RailButton
          label={fmtCount(counts.likes)}
          sub="like"
          icon={liked ? "❤️" : "🤍"}
          onClick={onLike}
          active={liked}
        />
        <RailButton
          label={fmtCount(counts.comments)}
          sub="chat"
          icon="💬"
          onClick={onComment}
        />
        <RailButton label={fmtCount(counts.shares)} sub="share" icon="↗" onClick={onShare} />
        <RailButton label={favorited ? "saved" : "save"} sub="later" onClick={onFavorite}>
          <StarIcon
            className={`h-7 w-7 ${favorited ? "text-accent" : "text-white"}`}
            filled={favorited}
          />
        </RailButton>
      </div>

      {/* bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-30 space-y-3 p-4 pr-20">
        <div className="flex items-center gap-2 text-xs text-white/90 text-glow">
          <span className="font-bold">@{item.author ?? "unclaimed"}</span>
          {item.source === "UPLOAD" && (
            <span className="rounded bg-accent/25 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-accent">
              CREATOR
            </span>
          )}
          <span className="text-white/50">·</span>
          <span className="text-white/60">{fmtCount(counts.views)} views</span>
        </div>

        <p className="line-clamp-2 text-sm font-medium text-white/95 text-glow">
          {item.caption ?? `$${sym(coin.symbol)}`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-black tracking-wide text-white">
            ${sym(coin.symbol)}
          </span>
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${
              up ? "bg-up/20 text-up" : "bg-down/20 text-down"
            }`}
          >
            {fmtPct(coin.change24hPct)}
          </span>
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            MC {fmtSol(coin.marketCapSol)} SOL · {fmtUsd(coin.marketCapSol * solUsd)}
          </span>
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            {fmtPrice(coin.priceSol)} SOL
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
  label: string;
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
      className="flex flex-col items-center gap-0.5 text-white transition active:scale-95"
    >
      {children ? (
        children
      ) : art ? (
        <CoinAvatar
          src={art}
          symbol={symbol ?? label}
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

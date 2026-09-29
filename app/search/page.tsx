"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SearchResponse, TokenHitDTO, UserCardDTO } from "@/lib/types";
import { FollowButton, TokenFollowButton } from "@/components/FollowButton";
import { SearchIcon } from "@/components/Icons";
import { CoinAvatar } from "@/components/CoinAvatar";
import { artUrl } from "@/lib/art-url";
import { fmtPct, fmtPrice, fmtSol, sym } from "@/lib/format";

/**
 * One search box for both people and tokens.
 *
 * Deliberately not split into tabs. The person typing "@dave" does not know or
 * care whether that resolves to an account or a coin, and asking them to pick a
 * category first is a worse experience than showing both sets and letting them
 * scan two short lists.
 *
 * The query is debounced rather than fired per keystroke: each request is a pair
 * of `contains` scans that cannot use an index, so typing "solana" one letter at
 * a time would be eight full scans of two tables. 220ms is short enough that it
 * still feels immediate and long enough to collapse a typed word into one call.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchShell />}>
      <SearchInner />
    </Suspense>
  );
}

function SearchShell() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-3" />
    </div>
  );
}

function UserAvatar({ user, size = 40 }: { user: UserCardDTO; size?: number }) {
  const [broken, setBroken] = useState(false);
  const px = `${size}px`;
  if (user.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-line bg-panel2 text-sm font-black text-muted"
      style={{ width: px, height: px }}
    >
      {(user.name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

function SearchInner() {
  const initial = useSearchParams().get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 1) {
      setRes(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(term.trim())}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as SearchResponse;
      setRes({ users: j.users ?? [], tokens: j.tokens ?? [] });
    } catch {
      setRes({ users: [], tokens: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Seed the first search when arriving with ?q=, and focus so a tap on the
  // header icon lands with the keyboard already up.
  useEffect(() => {
    inputRef.current?.focus();
    if (initial.trim()) void run(initial);
  }, [initial, run]);

  const onChange = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(v), 220);
  };

  // Cancel a pending debounce on unmount, so navigating away mid-word cannot
  // fire a request that sets state on a dead component.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const users = res?.users ?? [];
  const tokens = res?.tokens ?? [];
  const empty = res && q.trim() && !loading && users.length === 0 && tokens.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3 py-2">
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            placeholder="search people or tokens"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          {q && (
            <button
              onClick={() => {
                setQ("");
                setRes(null);
                inputRef.current?.focus();
              }}
              aria-label="Clear"
              className="press shrink-0 rounded-full px-1.5 text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!res && !loading && (
          <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
            <SearchIcon className="h-8 w-8 text-muted" />
            <p className="text-sm font-bold">Find people and tokens</p>
            <p className="text-xs text-muted">
              Search a handle like <span className="text-ink">@dave</span>, a token symbol, a name,
              or paste a mint address.
            </p>
          </div>
        )}

        {empty && (
          <div className="px-6 py-16 text-center text-xs text-muted">
            Nothing matched “{q.trim()}”.
          </div>
        )}

        {users.length > 0 && (
          <section className="pt-2">
            <h2 className="px-4 pb-1 pt-3 text-[10px] font-black uppercase tracking-wider text-muted">
              People
            </h2>
            <ul>
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/u/${encodeURIComponent(u.slug)}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <UserAvatar user={u} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold">{u.name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {u.followers} follower{u.followers === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                  <FollowButton traderId={u.id} initialFollowing={u.isFollowing} isMe={u.isMe} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {tokens.length > 0 && (
          <section className="pb-6 pt-2">
            <h2 className="px-4 pb-1 pt-3 text-[10px] font-black uppercase tracking-wider text-muted">
              Tokens
            </h2>
            <ul>
              {tokens.map((t) => (
                <TokenRow key={t.mint} t={t} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function TokenRow({ t }: { t: TokenHitDTO }) {
  const up = t.change24hPct >= 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Link href={`/coin/${encodeURIComponent(t.symbol)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <CoinAvatar src={t.imageUrl} symbol={t.symbol} className="h-10 w-10 rounded-full border border-line" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold">
            ${sym(t.symbol)}
            <span className="ml-1.5 font-medium text-muted">{t.name}</span>
          </span>
          <span className="flex items-center gap-2 text-[11px] text-muted tabular-nums">
            <span>{fmtPrice(t.priceSol)} SOL</span>
            <span className={up ? "text-up" : "text-down"}>{fmtPct(t.change24hPct)}</span>
            <span>MC {fmtSol(t.marketCapSol)}</span>
          </span>
        </span>
      </Link>
      <TokenFollowButton mint={t.mint} initialFollowing={t.isFollowing} />
    </li>
  );
}

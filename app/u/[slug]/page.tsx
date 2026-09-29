"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ProfileResponse } from "@/lib/types";
import { FollowButton } from "@/components/FollowButton";
import { CoinAvatar } from "@/components/CoinAvatar";
import { artUrl } from "@/lib/art-url";
import { fmtCount, sym } from "@/lib/format";

/**
 * A public profile: who this is, and what they have posted.
 *
 * Reachable without a login, because a profile that could not be linked to or
 * shared would defeat most of the point of having one. Addressed by username
 * when one is claimed and by row id otherwise, so every account has a page even
 * if it never claimed a handle.
 *
 * The grid is the creator's own uploads — not their likes or their holdings.
 * Those are private, and a "profile" that exposed someone's positions would be
 * a serious surprise.
 */
export default function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [d, setD] = useState<ProfileResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.detail ?? j.error ?? "not found");
        return;
      }
      setD(j as ProfileResponse);
    } catch {
      setErr("could not load that profile");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="font-bold">No account for “{slug}”.</p>
        <Link href="/search" className="text-xs text-accent">
          search people
        </Link>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted">loading…</div>
    );
  }

  const { user, clips } = d;
  const initial = (user.name.replace(/^@/, "")[0] ?? "?").toUpperCase();

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <header className="border-b border-line px-4 pb-4 pt-5">
        <div className="flex items-start gap-3">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-line object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-line bg-panel2 text-xl font-black text-muted">
              {initial}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black leading-tight">{user.name}</h1>
            <div className="mt-1 flex gap-4 text-[12px]">
              <span>
                <span className="font-black tabular-nums">{fmtCount(user.followers)}</span>{" "}
                <span className="text-muted">followers</span>
              </span>
              <span>
                <span className="font-black tabular-nums">{fmtCount(user.following)}</span>{" "}
                <span className="text-muted">following</span>
              </span>
            </div>
          </div>

          <FollowButton traderId={user.id} initialFollowing={user.isFollowing} isMe={user.isMe} size="md" />
        </div>

        {user.bio && <p className="mt-3 text-[12px] text-white/80">{user.bio}</p>}

        {!user.username && !user.isMe && (
          <p className="mt-3 text-[11px] text-muted">
            This account has not claimed a handle yet.
          </p>
        )}
      </header>

      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <h2 className="text-[10px] font-black uppercase tracking-wider text-muted">
          Clips
        </h2>
        <span className="text-[11px] text-muted tabular-nums">{d.total}</span>
      </div>

      {clips.length === 0 ? (
        <p className="px-6 py-12 text-center text-xs text-muted">
          No clips yet.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1 p-1">
          {clips.map((c) => {
            const thumb = c.thumbUrl ?? artUrl(c.coin.imageUrl);
            return (
              <li key={c.id}>
                <Link
                  href={`/coin/${encodeURIComponent(c.coin.symbol)}`}
                  className="press relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-panel2"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[10px] text-muted">
                      no preview
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-black">
                    ${sym(c.coin.symbol)}
                  </span>
                  {!c.videoUrl && (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-bold text-white/80">
                      art
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

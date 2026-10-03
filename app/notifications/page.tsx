"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { NotificationDTO, NotificationsResponse } from "@/lib/types";
import { useAuth } from "@/components/AuthBridge";
import { EmptyState } from "@/components/Mascots";
import { artUrl } from "@/lib/art-url";
import { timeAgo } from "@/lib/format";

/**
 * The inbox.
 *
 * Opening it marks everything read — the list *is* the acknowledgement, and a
 * per-row "mark as read" on a notification feed is a chore nobody performs. The
 * bell badge is what tells you there was something new; once you are looking at
 * the list you have already seen it.
 *
 * The marking happens after the list renders, not before, so the screen never
 * waits on a write to show what it already has.
 */
export default function NotificationsPage() {
  const { enabled, authenticated, login, getToken } = useAuth();
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    if (!authenticated) {
      setItems([]);
      return;
    }
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/notifications?limit=50", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = (await r.json()) as NotificationsResponse;
      setItems(j.notifications ?? []);
      setUnread(j.unread ?? 0);
      if ((j.unread ?? 0) > 0) {
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ all: true }),
        }).catch(() => {});
        setUnread(0);
      }
    } catch {
      setItems([]);
    }
  }, [authenticated, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (enabled && !authenticated) {
    return (
      <EmptyState
        mascot="dog"
        size={80}
        title="Notifications need an account."
        action={
          <button
            onClick={login}
            className="press rounded-xl burn-gradient px-5 py-2.5 text-[12px] font-black text-black"
          >
            Log in
          </button>
        }
      />
    );
  }

  if (!items) {
    return <div className="flex h-full items-center justify-center text-xs text-muted">loading…</div>;
  }

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h1 className="text-sm font-black">Notifications</h1>
        {items.length > 0 && (
          <span className="text-[11px] text-muted">
            {unread > 0 ? `${unread} unread` : "all caught up"}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          mascot="dog"
          size={76}
          title="Nothing yet."
          body="Follow some people or tokens and their activity lands here."
          className="py-16"
        />
      ) : (
        <ul>
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationDTO }) {
  const thumb = n.clipThumb ?? artUrl(n.coinImage);
  const who = n.actor?.name ?? "someone";

  const href =
    n.type === "FOLLOW"
      ? n.actor
        ? `/u/${encodeURIComponent(n.actor.slug)}`
        : "/search"
      : n.coinSymbol
        ? `/coin/${encodeURIComponent(n.coinSymbol)}`
        : "/";

  const text =
    n.type === "FOLLOW" ? (
      <>
        <b className="font-black">{who}</b> started following you
      </>
    ) : n.type === "UPLOAD" ? (
      <>
        <b className="font-black">{who}</b> posted a new clip
        {n.coinSymbol ? <> · ${n.coinSymbol}</> : null}
      </>
    ) : (
      <>
        New clip on <b className="font-black">${n.coinSymbol ?? "a token"}</b> you follow
      </>
    );

  return (
    <li className={n.read ? "" : "bg-accent/5"}>
      <Link href={href} className="press flex items-center gap-3 px-4 py-3">
        <span className="relative shrink-0">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-11 w-11 rounded-lg border border-line object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-panel2 text-[13px] font-black text-muted">
              {(who.replace(/^@/, "")[0] ?? "?").toUpperCase()}
            </span>
          )}
          {!n.read && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{text}</span>
          <span className="block text-[11px] text-muted">{timeAgo(n.at)}</span>
        </span>

        {n.type !== "FOLLOW" && (
          <span className="shrink-0 rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10px] font-black">
            watch
          </span>
        )}
      </Link>
    </li>
  );
}

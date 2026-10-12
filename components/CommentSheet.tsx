"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CommentDTO } from "@/lib/types";
import { useAuth } from "./AuthBridge";
import { EmptyState } from "./Mascots";
import { CalloutRail } from "./CalloutRail";
import { timeAgo } from "@/lib/format";

/**
 * The comments and callouts for one clip, as two tabs of one sheet.
 *
 * Reading is public; writing requires a login, so the composer is replaced by a
 * prompt when signed out. The count is reported back up so the rail updates
 * without a feed refetch.
 *
 * The second tab is pump.fun's callouts for the same coin — who is holding it
 * and what they said — which is the half of the conversation a comment section
 * never shows.
 */
export function CommentSheet({
  clipId,
  symbol,
  mint,
  open,
  initialTab = "comments",
  onClose,
  onCount,
}: {
  clipId: string;
  symbol: string;
  mint: string;
  open: boolean;
  /**
   * Which tab to land on. The feed opens this on Callouts when the coin has
   * callouts, so the number the viewer tapped is the number they see — and on
   * Comments when it has none, so nobody is dropped onto an empty list.
   */
  initialTab?: "comments" | "callouts";
  onClose: () => void;
  onCount: (n: number) => void;
}) {
  const { enabled, authenticated, login, getToken } = useAuth();
  const [tab, setTab] = useState<"comments" | "callouts">(initialTab);
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/clips/${clipId}/comments`, { cache: "no-store" });
      const j = (await r.json()) as { comments?: CommentDTO[]; count?: number };
      setComments(j.comments ?? []);
      if (typeof j.count === "number") onCount(j.count);
    } catch {
      /* leave the list as-is */
    }
  }, [clipId, onCount]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const post = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("session expired — log in again");

      const r = await fetch(`/api/clips/${clipId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: text }),
      });
      const j = (await r.json()) as { detail?: string; error?: string; count?: number };
      if (!r.ok) throw new Error(j.detail || j.error || "could not post that");

      setBody("");
      if (typeof j.count === "number") onCount(j.count);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [body, clipId, getToken, load, onCount]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="sheet-up relative flex h-[70vh] w-full max-w-md flex-col rounded-t-3xl border-t border-line bg-panel shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line" />

        <div className="flex shrink-0 items-center gap-2 px-4 py-3">
          <div className="flex rounded-full border border-line bg-panel2 p-0.5">
            <TabButton active={tab === "comments"} onClick={() => setTab("comments")}>
              Comments
            </TabButton>
            <TabButton active={tab === "callouts"} onClick={() => setTab("callouts")}>
              Callouts
            </TabButton>
          </div>
          <span className="ml-auto shrink-0 text-[11px] font-black text-muted">${symbol}</span>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            close
          </button>
        </div>

        {tab === "callouts" ? (
          // The rail owns its own scroll, so it fills the sheet directly.
          <div className="flex min-h-0 flex-1 flex-col border-t border-line">
            <CalloutRail mint={mint} open={open} />
          </div>
        ) : (
          <>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-line">
              {comments.length === 0 && (
                <EmptyState
                  mascot="fwog"
                  size={72}
                  title="No comments yet."
                  body="Be the first."
                  className="py-10"
                />
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5 border-b border-line px-4 py-3">
                  <div className="mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-panel2">
                    {c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-muted">
                        {c.author.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[11px] font-bold">
                        {c.author}
                        {c.mine && <span className="ml-1.5 text-[9px] text-accent">you</span>}
                      </span>
                      <span className="ml-auto shrink-0 text-[9px] text-muted">
                        {timeAgo(c.at)} ago
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-[13px] leading-snug">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="shrink-0 border-t border-line p-3 pb-5">
              {!enabled ? (
                <p className="text-center text-[11px] text-muted">
                  Comments are unavailable on this deployment.
                </p>
              ) : authenticated ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !busy) void post();
                      }}
                      maxLength={280}
                      placeholder="add a comment…"
                      className="min-w-0 flex-1 rounded-xl border border-line bg-panel2 px-3 py-2.5 text-[13px] outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => void post()}
                      disabled={busy || !body.trim()}
                      className="shrink-0 rounded-xl burn-gradient px-4 py-2.5 text-[12px] font-black text-black disabled:opacity-40"
                    >
                      {busy ? "…" : "Post"}
                    </button>
                  </div>
                  {error && <p className="mt-2 text-[11px] text-down">{error}</p>}
                </>
              ) : (
                <button
                  onClick={login}
                  className="w-full rounded-xl burn-gradient py-3 text-[12px] font-black text-black"
                >
                  Log in to comment
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One of the sheet's two tabs. The active one is filled, the other is a label. */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-[11px] font-black transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

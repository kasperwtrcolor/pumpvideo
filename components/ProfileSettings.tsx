"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTrader } from "./TraderProvider";
import { useAuth } from "./AuthBridge";

/**
 * Claim a handle, write a bio.
 *
 * The handle is what makes an account linkable and searchable, so it is worth
 * asking for — but it stays optional, and this section says so. An account with
 * no handle still works: it can be followed by id, and its clips still credit a
 * creator.
 *
 * Length and character rules are checked here for fast feedback, and again on
 * the server, which is the check that actually holds — this one is a courtesy,
 * not a boundary.
 */
export function ProfileSettings() {
  const { trader, refresh } = useTrader();
  const { getToken } = useAuth();

  const [username, setUsername] = useState(trader?.username ?? "");
  const [bio, setBio] = useState(trader?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    setBad(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("session expired — log in again");
      const r = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, bio }),
      });
      const j = (await r.json()) as { detail?: string; error?: string; username?: string | null };
      if (!r.ok) throw new Error(j.detail || j.error || "could not save");
      setUsername(j.username ?? "");
      setMsg("saved");
      await refresh();
    } catch (e) {
      setBad(true);
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [username, bio, getToken, refresh]);

  if (!trader) return null;

  const dirty = username !== (trader.username ?? "") || bio !== (trader.bio ?? "");

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-bold tracking-wide">Public profile</h2>

      <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted">
        Handle
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3">
        <span className="text-[13px] font-bold text-muted">@</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20))}
          placeholder="yourhandle"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-muted"
        />
      </div>
      <p className="mt-1 text-[10px] text-muted">
        3–20 letters, numbers or underscores. Optional — but it is what lets people find and link
        to you. Clear it any time.
      </p>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-widest text-muted">
        Bio
      </label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value.slice(0, 160))}
        rows={2}
        placeholder="what you post about"
        className="mt-1 w-full resize-none rounded-xl border border-line bg-panel2 px-3 py-2.5 text-[13px] outline-none placeholder:text-muted focus:border-accent"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="press rounded-xl burn-gradient px-4 py-2 text-[12px] font-black text-black disabled:opacity-40"
        >
          {busy ? "saving…" : "Save"}
        </button>
        {trader.username && (
          <Link
            href={`/u/${encodeURIComponent(trader.username)}`}
            className="text-[11px] text-muted underline hover:text-ink"
          >
            view profile
          </Link>
        )}
        {msg && (
          <span className={`text-[11px] font-bold ${bad ? "text-down" : "text-up"}`}>{msg}</span>
        )}
      </div>
    </section>
  );
}

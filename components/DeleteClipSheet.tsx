"use client";

import { useCallback, useState } from "react";
import { useTrader } from "./TraderProvider";
import { useAuth } from "./AuthBridge";

/**
 * The confirm sheet for deleting one of your own clips.
 *
 * A sheet rather than a `window.confirm` for the same reason every other action
 * here is one: this is a phone-width app, and the native dialog is both ugly and
 * unstyleable. It is also deliberately a *confirmation* — deletion is
 * irreversible and takes the video file with it, so it is never one tap.
 *
 * The copy states the true blast radius. A creator's instinct is to fear that
 * deleting the clip removes the coin or their earnings; neither is true, and
 * saying so is what makes the button safe to press.
 */
export function DeleteClipSheet({
  clipId,
  symbol,
  open,
  onClose,
  onDeleted,
}: {
  clipId: string;
  symbol: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useTrader();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("session expired — log in again");
      const r = await fetch(`/api/clips/${clipId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
      if (!r.ok) throw new Error(j.detail || j.error || "could not delete that clip");
      toast("clip deleted");
      onDeleted();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }, [clipId, getToken, toast, onDeleted]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center">
      <button
        aria-label="close"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="sheet-up relative w-full max-w-md rounded-t-3xl border-t border-line bg-panel p-5 pb-8 shadow-2xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <h2 className="text-center text-base font-black tracking-tight">Delete this clip?</h2>
        <p className="mt-1 text-center text-[12px] leading-relaxed text-muted">
          Your video for ${symbol} will be removed from your profile and every feed. This cannot be
          undone.
        </p>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-muted">
          The token itself is untouched, and any creator fees you have already earned stay yours.
        </p>

        <button
          onClick={() => void remove()}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-down py-3.5 text-sm font-black tracking-wide text-white disabled:opacity-50"
        >
          {busy ? "deleting…" : "Delete clip"}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="mt-2 w-full rounded-xl border border-line bg-panel2 py-3 text-sm font-bold text-ink disabled:opacity-50"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

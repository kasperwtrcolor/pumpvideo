/**
 * The install prompt, held until something asks for it.
 *
 * Chromium fires `beforeinstallprompt` once, early, and the event is useless
 * unless it is stashed and later replayed from a user gesture — calling
 * `prompt()` outside a gesture is ignored. So the listener lives in
 * `InstallBridge` (mounted once in the layout) and parks the event here, and the
 * nudge renders an "Install" button only when one is parked.
 *
 * Same tiny-store shape as lib/welcome.ts.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Listener = () => void;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function getInstalled(): boolean {
  return installed;
}

export function setInstallPrompt(e: BeforeInstallPromptEvent): void {
  deferred = e;
  emit();
}

export function clearInstallPrompt(): void {
  if (!deferred) return;
  deferred = null;
  emit();
}

export function markInstalled(): void {
  installed = true;
  emit();
}

export function subscribeInstall(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Replay the parked prompt. Returns whether the visitor accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const choice = await e.userChoice;
  if (choice.outcome === "accepted") installed = true;
  deferred = null;
  emit();
  return choice.outcome === "accepted";
}

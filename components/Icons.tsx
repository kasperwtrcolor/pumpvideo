/**
 * Nav glyphs — outlined.
 *
 * Inline SVG on purpose: no icon dependency, no extra bundle, and they inherit
 * `currentColor` so the active state is just a text-colour change. Sized by the
 * caller (the bottom bar renders them large).
 *
 * These are stroke drawings, not fills. A stroked glyph keeps its interior open,
 * which is what makes an icon bar read as "navigation" rather than a row of
 * solid blobs at 28px — and it gives the active tab somewhere to go (see
 * `filled` on StarIcon): the selected tab turns the outline solid.
 *
 * Every path is hand-authored on a 24×24 grid, so the shapes are checked by eye
 * in a browser rather than trusted to be right.
 */

type IconProps = { className?: string };

/** Shared stroke setup. `currentColor` is what makes the active state free. */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
      <path d="M3 10.4 12 3.2l9 7.2" />
      <path d="M5.6 9.5v10.1a1.2 1.2 0 0 0 1.2 1.2h3.1v-5.4h4.2v5.4h3.1a1.2 1.2 0 0 0 1.2-1.2V9.5" />
    </svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
      <path d="M5 20.2V11" />
      <path d="M9.7 20.2V4.6" />
      <path d="M14.3 20.2v-6.7" />
      <path d="M19 20.2V8" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2.1} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * Favourite. Ten vertices computed on a 5-point star (outer R 9.2, inner r 3.9,
 * centred at 12,12.6) rather than eyeballed — a hand-guessed star path is
 * lopsided in a way that is obvious once it is on screen.
 *
 * `filled` is the saved state.
 */
export function StarIcon({
  className,
  filled,
}: IconProps & { filled?: boolean }) {
  const d =
    "M12 3.4 14.29 9.45 20.75 9.76 15.71 13.81 17.41 20.04 12 16.5 6.59 20.04 8.29 13.81 3.25 9.76 9.71 9.45Z";
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      {...stroke}
      fill={filled ? "currentColor" : "none"}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
      <circle cx="12" cy="7.9" r="4.3" />
      <path d="M4.3 20.4c.85-3.35 4-5.5 7.7-5.5s6.85 2.15 7.7 5.5" />
    </svg>
  );
}

/**
 * Like. The action-rail heart.
 *
 * Two states on one glyph: the outline is "not liked", the solid fill is
 * "liked" — the same trick as `StarIcon`, so the state change is a fill rather
 * than a different picture, and the pop animation has something to land on.
 * The shape is a true heart (two lobes meeting at a point) rather than a
 * rounded blob, because at 30px the difference is obvious.
 */
export function HeartIcon({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      {...stroke}
      fill={filled ? "currentColor" : "none"}
      aria-hidden
    >
      <path d="M20.4 5.6a5 5 0 0 0-7.07 0L12 6.93l-1.33-1.33a5 5 0 1 0-7.07 7.07l1.33 1.33L12 21.07l7.07-7.07 1.33-1.33a5 5 0 0 0 0-7.07Z" />
    </svg>
  );
}

/**
 * Comment. A speech bubble, matching the shape a chat affordance is expected to
 * have — a rounded rectangle with a tail, not a circle.
 */
export function CommentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
      <path d="M20.5 11.6a7.9 7.9 0 0 1-8.5 7.9 8.6 8.6 0 0 1-3.4-.7L4 20.4l1.6-4.4a7.7 7.7 0 0 1-.9-3.6 7.9 7.9 0 0 1 8-7.8 8.1 8.1 0 0 1 7.8 7.6Z" />
    </svg>
  );
}

/**
 * Share. The iOS "share" glyph — an arrow leaving a tray.
 *
 * Preferred over a paper plane or a bare arrow because it is the shape most
 * people already read as "share", and this one also opens the native share
 * sheet, so the icon and the behaviour agree.
 */
export function ShareIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
      <path d="M4.5 13v5.6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M8.4 7.2 12 3.6l3.6 3.6" />
      <path d="M12 3.6v10.2" />
    </svg>
  );
}

/** A confirmation tick, for a control that just succeeded. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2.4} aria-hidden>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

/** Search. A magnifier — the one glyph nobody has to be taught. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.6 15.6 20.5 20.5" />
    </svg>
  );
}

/** The notification bell. */
export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={1.9} aria-hidden>
      <path d="M12 3.4a5.6 5.6 0 0 0-5.6 5.6c0 4.2-1.7 5.9-1.7 5.9h14.6s-1.7-1.7-1.7-5.9A5.6 5.6 0 0 0 12 3.4Z" />
      <path d="M10.2 18.6a1.95 1.95 0 0 0 3.6 0" />
    </svg>
  );
}

/** A person plus a sign — the "follow" affordance. */
export function UserPlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <circle cx="10" cy="8" r="3.9" />
      <path d="M3.4 19.6c.7-2.9 3.4-4.7 6.6-4.7 1.2 0 2.4.27 3.4.77" />
      <path d="M17.6 13.4v5.2" />
      <path d="M15 16h5.2" />
    </svg>
  );
}

/** A person plus a tick — the "following" state. */
export function UserCheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <circle cx="10" cy="8" r="3.9" />
      <path d="M3.4 19.6c.7-2.9 3.4-4.7 6.6-4.7 1.2 0 2.4.27 3.4.77" />
      <path d="M15 16.1l1.9 1.9 3.6-3.9" />
    </svg>
  );
}

/** A link that leaves the app. Always paired with a visible label. */
export function ExternalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <path d="M13.5 4.5h6v6" />
      <path d="M19.5 4.5 10.5 13.5" />
      <path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-10A1.5 1.5 0 0 1 6.5 7h4" />
    </svg>
  );
}

/**
 * X (formerly Twitter). A solid brand glyph, so it does not use the shared
 * stroke setup — it is filled with `currentColor` instead.
 */
export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Reshuffle. Two paths crossing and swapping sides — the standard glyph. */
export function ShuffleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <path d="M16 4h4.5v4.5" />
      <path d="M20.5 4 14 10.5" />
      <path d="M20.5 20H16" />
      <path d="M20.5 20 4 4" />
      <path d="M4 20l5-5" />
    </svg>
  );
}

/**
 * Sound. One glyph, two states: the waves are dropped and an X added when muted,
 * so the control reads as the same object in both states rather than two
 * unrelated pictures.
 */
export function VolumeIcon({ className, muted }: IconProps & { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} strokeWidth={2} aria-hidden>
      <path d="M11 5 6.5 8.8H3v6.4h3.5L11 19V5Z" />
      {muted ? (
        <>
          <path d="M15.5 9.5 20 14.5" />
          <path d="M20 9.5 15.5 14.5" />
        </>
      ) : (
        <>
          <path d="M14.8 9.2a4 4 0 0 1 0 5.6" />
          <path d="M17.8 6.4a8 8 0 0 1 0 11.2" />
        </>
      )}
    </svg>
  );
}

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

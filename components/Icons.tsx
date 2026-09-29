/**
 * Nav glyphs.
 *
 * Inline SVG on purpose: no icon dependency, no extra bundle, and they inherit
 * `currentColor` so the active state is just a text-colour change. Sized by the
 * caller (the bottom bar renders them large).
 */

type IconProps = { className?: string };

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 3.1 2.6 10.6a1 1 0 0 0 .63 1.78H5v7.6a1.5 1.5 0 0 0 1.5 1.5h3.2v-5.4h4.6v5.4h3.2a1.5 1.5 0 0 0 1.5-1.5v-7.6h1.77a1 1 0 0 0 .63-1.78L12 3.1Z" />
    </svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="2.5" y="10" width="3.6" height="11" rx="1.2" />
      <rect x="8.2" y="4" width="3.6" height="17" rx="1.2" />
      <rect x="13.9" y="13" width="3.6" height="8" rx="1.2" />
      <rect x="19.6" y="7" width="3.6" height="14" rx="1.2" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 12.2a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2Z" />
      <path d="M12 14.3c-4.5 0-8.1 2.5-8.1 5.6v.6a1 1 0 0 0 1 1h14.2a1 1 0 0 0 1-1v-.6c0-3.1-3.6-5.6-8.1-5.6Z" />
    </svg>
  );
}

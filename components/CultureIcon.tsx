/**
 * Culture icons — the memecoin cast, drawn in the same chibi sticker style as
 * the brand mascots (public/brand): thick dark outline, soft flat fills, big
 * eyes, transparent background. Where the brand mascots are four fixed
 * characters cut from a banner, these are authored as vectors so they stay
 * crisp at any size and can be dropped in anywhere a mascot is used.
 *
 * Sources are inline SVG strings (lib/culture-icons.json) rather than files so
 * they inherit no HTTP request and can be recoloured/scaled via CSS. The markup
 * is our own static data — no user input — so injecting it is safe.
 *
 * These are decorative: the copy next to them says what the moment is, so they
 * are `aria-hidden`.
 */
import RAW from "@/lib/culture-icons.json";

export type CultureName = keyof typeof RAW;

type Entry = { label: string; svg: string };
const ICONS = RAW as Record<string, Entry>;

export const CULTURE_NAMES = Object.keys(ICONS) as CultureName[];

/** Ordered for display, with a human label (used on the /culture preview). */
export const CULTURE: { name: CultureName; label: string }[] = CULTURE_NAMES.map((name) => ({
  name,
  label: ICONS[name].label,
}));

export function isCultureName(n: string): n is CultureName {
  return Object.prototype.hasOwnProperty.call(ICONS, n);
}

/** One culture sticker, sized like a `Mascot`. */
export function CultureIcon({
  name,
  size = 64,
  className = "",
}: {
  name: CultureName;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: ICONS[name].svg }}
    />
  );
}

/**
 * The Pemp mascots — the dog in the beanie, Pepe, the cat, and the Solana mark,
 * cut from the brand banner (public/brand). They are the friendly, human face of
 * a product that is otherwise charts and wallets, so they are used sparingly:
 * the welcome screen, and the moments where the app has nothing to show and a
 * plain line of grey text would feel cold.
 *
 * Each is a transparent PNG, so it sits on any surface without a white box.
 */

export type MascotName = "dog" | "pepe" | "cat" | "solana";

/** Ordered as they appear in the banner. Decorative — copy next to them already
 * says what the picture is, so `alt` is empty. */
export const MASCOTS: { name: MascotName; src: string }[] = [
  { name: "dog", src: "/brand/dog.png" },
  { name: "pepe", src: "/brand/pepe.png" },
  { name: "cat", src: "/brand/cat.png" },
  { name: "solana", src: "/brand/solana.png" },
];

const SRC = Object.fromEntries(MASCOTS.map((m) => [m.name, m.src])) as Record<
  MascotName,
  string
>;

/** A single mascot, for an empty state or a nudge. */
export function Mascot({
  name = "dog",
  size = 88,
  className = "",
}: {
  name?: MascotName;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[name]}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

/**
 * An overlapping row of the mascots, for social proof next to a follow button.
 * Ringed with the page background so the faces read as a stack rather than a
 * smear.
 */
export function MascotStack({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center" aria-hidden>
      {MASCOTS.map((m, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={m.name}
          src={m.src}
          alt=""
          width={size}
          height={size}
          className="rounded-full bg-bg"
          style={{
            width: size,
            height: size,
            objectFit: "contain",
            marginLeft: i === 0 ? 0 : -size * 0.34,
            zIndex: MASCOTS.length - i,
            position: "relative",
          }}
        />
      ))}
    </span>
  );
}

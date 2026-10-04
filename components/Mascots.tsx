/**
 * The Pemp mascots — the dog in the beanie, Pepe, the cat, and the Solana mark,
 * cut from the brand banner (public/brand). They are the friendly, human face of
 * a product that is otherwise charts and wallets, so they are used sparingly:
 * the welcome screen, and the moments where the app has nothing to show and a
 * plain line of grey text would feel cold.
 *
 * Each is a transparent PNG, so it sits on any surface without a white box.
 */
import type { ReactNode } from "react";
import { CultureIcon, isCultureName, type CultureName } from "./CultureIcon";

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
 * An overlapping row of faces, for social proof next to a follow button —
 * the brand mascots interleaved with the memecoin culture icons, so the row
 * reads as a community rather than a fixed cast. Ringed with the page
 * background so the faces read as a stack rather than a smear.
 */
const STACK: ({ kind: "mascot"; name: MascotName } | { kind: "culture"; name: CultureName })[] = [
  { kind: "mascot", name: "solana" },
  { kind: "culture", name: "bonk" },
  { kind: "mascot", name: "dog" },
  { kind: "culture", name: "pengu" },
  { kind: "mascot", name: "pepe" },
  { kind: "culture", name: "wif" },
  { kind: "mascot", name: "cat" },
];

export function MascotStack({ size = 30 }: { size?: number }) {
  const overlap = -size * 0.34;
  return (
    <span className="flex items-center" aria-hidden>
      {STACK.map((m, i) => (
        <span
          key={`${m.kind}-${m.name}`}
          className="rounded-full bg-bg"
          style={{
            width: size,
            height: size,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: i === 0 ? 0 : overlap,
            zIndex: STACK.length - i,
            position: "relative",
          }}
        >
          {m.kind === "culture" ? (
            <CultureIcon name={m.name} size={size} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={SRC[m.name]}
              alt=""
              width={size}
              height={size}
              style={{ width: size, height: size, objectFit: "contain" }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * The friendly "nothing here" block, used wherever a screen would otherwise be
 * one grey line of text. A mascot does the emotional work; the caller supplies
 * the words and, when there is a way out, the action.
 */
export function EmptyState({
  mascot = "dog",
  size = 84,
  title,
  body,
  action,
  className = "",
}: {
  mascot?: MascotName | CultureName;
  size?: number;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-8 text-center ${className}`}
    >
      {isCultureName(mascot) ? (
        <CultureIcon name={mascot} size={size} />
      ) : (
        <Mascot name={mascot} size={size} />
      )}
      <p className="text-lg font-bold">{title}</p>
      {body ? <p className="text-xs leading-relaxed text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

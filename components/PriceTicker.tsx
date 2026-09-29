"use client";

/**
 * A tiny price sparkline.
 *
 * Deliberately not a charting dependency: this draws a single polyline from the
 * samples the feed has already collected, so it costs no extra request and no
 * bundle. The samples are the ones this session has actually observed, so the
 * line means "this is what the price has done while you were watching" — which
 * is the question a swipe feed is answering.
 */
export function Sparkline({
  samples,
  className = "",
}: {
  samples: number[];
  className?: string;
}) {
  if (samples.length < 2) return null;

  const w = 100;
  const h = 28;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1; // a flat line is drawn flat, not divided by zero

  const pts = samples
    .map((v, i) => {
      const x = (i / (samples.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const up = samples[samples.length - 1] >= samples[0];
  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`h-6 w-full ${className}`}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A pulsing dot marking a price that is genuinely coming in live, rather than
 * the market keeper's cached number. Worth distinguishing — the two numbers look
 * identical on screen but only one moves second to second.
 */
export function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      title={live ? "live price" : "last keeper refresh"}
      className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
        live ? "pulse-dot bg-up" : "bg-white/35"
      }`}
    />
  );
}

"use client";

/**
 * The Pemp mark: a "P" whose counter is a play triangle — the brand initial
 * and the product's core action (watch a clip) in one glyph.
 *
 * Rendered from the shipped raster (public/logo.png, generated from the
 * public/brand/logo.png master via scripts/gen-icons.mjs) rather than a hand
 * SVG, so the in-app mark is the same asset as the app icon. Its corners are
 * transparent, so no extra rounding is applied here.
 */
export function LogoMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Pemp"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

/** Mark + wordmark, sized for the top nav. */
export function LogoLockup({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <LogoMark size={size} />
      <span className="text-[13px] font-black tracking-[0.14em]">PEMP</span>
    </span>
  );
}

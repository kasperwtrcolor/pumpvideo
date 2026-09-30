"use client";

import { useId } from "react";

/**
 * The Pemp mark: a "P" whose counter is a play triangle — the brand initial
 * and the product's core action (watch a clip) in one glyph.
 *
 * Gradients carry document-global ids, so `useId()` keeps multiple instances
 * from clobbering each other's fills.
 */
export function LogoMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  const uid = useId().replace(/[:]/g, "");
  const g = `pcg-${uid}`;
  const s = `pcs-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Pemp"
    >
      <defs>
        <linearGradient id={g} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4dff9a" />
          <stop offset="0.52" stopColor="#22e06a" />
          <stop offset="1" stopColor="#0a9d4a" />
        </linearGradient>
        <linearGradient id={s} x1="10" y1="6" x2="34" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="17" fill={`url(#${g})`} />
      <rect x="0" y="0" width="64" height="64" rx="17" fill={`url(#${s})`} />
      <rect x="15.5" y="13" width="9.5" height="38" rx="4.75" fill="#05130c" />
      <path
        d="M25 13 H36.5 C44.2 13 50.5 18.4 50.5 25.2 C50.5 32 44.2 37.4 36.5 37.4 H25 Z"
        fill="#05130c"
      />
      <path d="M33.8 19.4 L43.6 25.2 L33.8 31 Z" fill={`url(#${g})`} />
    </svg>
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

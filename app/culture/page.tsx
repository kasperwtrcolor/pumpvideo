import { CULTURE, CultureIcon } from "@/components/CultureIcon";

export const metadata = {
  title: "Pemp — culture icons",
};

/**
 * Preview of the culture-icon set. Not linked from the app chrome — it exists so
 * the cast can be seen all at once, at several sizes, on the real theme. Each
 * icon is drawn as vector markup, so the sizes below are the same asset at
 * different scales, not different files.
 */
export default function CulturePage() {
  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <h1 className="text-2xl font-black tracking-tight">Culture icons</h1>
        <p className="mt-1 text-xs text-muted">
          The memecoin cast, drawn in the brand sticker style: thick outline, soft fills,
          transparent background. {CULTURE.length} icons, all vector.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CULTURE.map((c) => (
            <div
              key={c.name}
              className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-6"
            >
              <CultureIcon name={c.name} size={96} />
              <span className="text-xs font-bold">{c.label}</span>
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-sm font-black">At clip sizes</h2>
        <p className="mt-1 text-xs text-muted">How they read small — avatars and empty states.</p>
        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-panel px-4 py-5">
          {CULTURE.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-2">
              <CultureIcon name={c.name} size={48} />
              <CultureIcon name={c.name} size={28} />
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-sm font-black">On the paper background</h2>
        <p className="mt-1 text-xs text-muted">
          Transparent, so they sit on any surface without a white box.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-6 rounded-2xl bg-ink px-4 py-6">
          {CULTURE.map((c) => (
            <CultureIcon key={c.name} name={c.name} size={56} />
          ))}
        </div>
      </div>
    </div>
  );
}

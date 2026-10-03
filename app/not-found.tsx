import Link from "next/link";
import { Mascot } from "@/components/Mascots";

/**
 * 404. A dead end is exactly the moment a friendly face is worth more than a
 * stern one, so this one gets a mascot and a single way back rather than a bare
 * "not found".
 */
export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Mascot name="pepe" size={96} />
      <p className="text-2xl font-black tracking-tight">Lost the plot.</p>
      <p className="text-xs leading-relaxed text-muted">
        That page does not exist. The feed, though, is right here.
      </p>
      <Link
        href="/"
        className="mt-1 rounded-xl burn-gradient px-5 py-2.5 text-[12px] font-black text-black active:scale-[0.99]"
      >
        Back to the feed
      </Link>
    </div>
  );
}

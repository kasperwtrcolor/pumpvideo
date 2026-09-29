import Link from "next/link";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";

/**
 * Shared frame for the legal documents: a scrollable reading column inside the
 * app shell, with cross-links and the entity details filled from lib/legal.ts.
 */
export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-bg">
      <article className="px-5 pb-16 pt-5">
        <nav className="mb-4 flex items-center gap-2 text-[11px] text-muted">
          <Link href="/" className="hover:text-ink">
            ← Back to feed
          </Link>
        </nav>

        <h1 className="text-xl font-black tracking-tight">{title}</h1>
        <p className="mt-1 text-[11px] text-muted">
          Last updated {LEGAL.lastUpdated} · {LEGAL.entity}
        </p>

        <p className="mt-4 rounded-xl border border-line bg-panel2 p-3 text-[11px] leading-relaxed text-muted">
          {intro}
        </p>

        <div className="legal-prose mt-6 space-y-5 text-[12px] leading-relaxed">{children}</div>

        <footer className="mt-10 border-t border-line pt-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.doc} href={l.href} className="text-muted underline hover:text-ink">
                {l.label}
              </Link>
            ))}
            <Link href="/" className="text-muted underline hover:text-ink">
              Feed
            </Link>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            © {new Date().getFullYear()} {LEGAL.entity}. {LEGAL.product} is a non-custodial
            interface to public Solana liquidity. Questions: {LEGAL.contactEmail}
          </p>
        </footer>
      </article>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[13px] font-black tracking-tight text-ink">{title}</h2>
      <div className="space-y-2 text-muted">{children}</div>
    </section>
  );
}

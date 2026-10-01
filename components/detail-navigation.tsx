import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

export function DetailNavigation({
  backHref,
  backLabel,
  previousHref,
  nextHref,
}: {
  backHref: string;
  backLabel: string;
  previousHref?: string | null;
  nextHref?: string | null;
}) {
  return <nav className="detail-navigation" aria-label="Navegació del detall">
    <Link className="back-link" href={backHref}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      <span>{backLabel}</span>
    </Link>
    {(previousHref || nextHref) && <div className="flex items-center gap-1.5" aria-label="Navegació entre elements">
      {previousHref && <Link className="context-nav-link" href={previousHref}><ChevronLeft aria-hidden="true" className="size-4" />Anterior</Link>}
      {nextHref && <Link className="context-nav-link" href={nextHref}>Següent<ChevronRight aria-hidden="true" className="size-4" /></Link>}
    </div>}
  </nav>;
}

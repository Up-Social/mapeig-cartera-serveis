import Link from "next/link";
import { Eye } from "lucide-react";
import type { ReactNode } from "react";

export function WorkTable({ headings, children, empty, className = "" }: { headings: string[]; children: ReactNode; empty?: string; className?: string }) {
  return <div className="surface overflow-hidden">
    <div className="overflow-x-auto"><table className={`data-table responsive-table ${className}`}><thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
    {empty && <p className="p-8 text-center text-sm text-muted-foreground">{empty}</p>}
  </div>;
}

export function TableActionLink({ href, label }: { href: string; label: string; children?: ReactNode }) {
  return <Link aria-label={label} title={label} className="table-action" href={href}><Eye aria-hidden="true" className="size-4"/><span className="sr-only">{label}</span></Link>;
}

export function WorkPager({ href, page, pageCount, total, pageSize = 25 }: { href: (page: number) => string; page: number; pageCount: number; total: number; pageSize?: number }) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <nav aria-label="Paginació" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4 text-sm">
    <span>Mostrant {first}–{last} de {total.toLocaleString("ca-ES")} · Pàgina {page} de {pageCount}</span>
    <span className="flex gap-2"><Link aria-disabled={page <= 1} className={`rounded-md border px-3 py-2 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={href(Math.max(1, page - 1))}>Anterior</Link><Link aria-disabled={page >= pageCount} className={`rounded-md border px-3 py-2 ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`} href={href(Math.min(pageCount, page + 1))}>Següent</Link></span>
  </nav>;
}

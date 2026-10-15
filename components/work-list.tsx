import Link from "next/link";
import { Eye } from "lucide-react";
import { Children, cloneElement, isValidElement, type ReactNode, type HTMLAttributes } from "react";
import { WORK_TABLE_PROFILES, type WorkTableProfile } from "@/lib/work-table-profiles";

export function WorkTable({ profile, children, empty, className = "" }: { profile: WorkTableProfile; children: ReactNode; empty?: string; className?: string }) {
  const definition = WORK_TABLE_PROFILES[profile];
  const rows = Children.map(children, row => {
    if (!isValidElement<{ children?: ReactNode }>(row) || row.type !== "tr") return row;
    return cloneElement(row, { role: "row", children: Children.map(row.props.children, (cell, index) => {
      const column = definition.columns[index];
      if (!column || !isValidElement<HTMLAttributes<HTMLTableCellElement>>(cell) || cell.type !== "td") return cell;
      return cloneElement(cell, { role: "cell", "data-label": column.label, "data-column": column.id, "data-role": column.role } as HTMLAttributes<HTMLTableCellElement>);
    }) } as HTMLAttributes<HTMLTableRowElement>);
  });
  return <div className="surface work-table-container" data-minimum={definition.minimum} data-profile={profile}>
    <table role="table" className={`data-table work-table ${className}`}>
      <caption className="sr-only">{definition.caption}</caption>
      <colgroup>{definition.columns.map(column => <col key={column.id} style={{ width: `${column.width}%` }}/>)}</colgroup>
      <thead role="rowgroup"><tr role="row">{definition.columns.map(column => <th key={column.id} scope="col" data-role={column.role}>{column.role === "selection" ? <span className="sr-only">{column.label}</span> : column.label}</th>)}</tr></thead><tbody role="rowgroup">{rows}</tbody>
    </table>
    {empty && <p className="p-8 text-center text-sm text-muted-foreground">{empty}</p>}
  </div>;
}

export function TableActionLink({ href, label, children = "Obrir cas" }: { href: string; label: string; children?: ReactNode }) {
  return <Link aria-label={label} title={label} className="table-action" href={href}><Eye aria-hidden="true" className="size-4 shrink-0"/><span>{children}</span></Link>;
}

export function WorkPager({ href, page, pageCount, total, pageSize = 25 }: { href: (page: number) => string; page: number; pageCount: number; total: number; pageSize?: number }) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <nav aria-label="Paginació" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4 text-sm">
    <span>Mostrant {first}–{last} de {total.toLocaleString("ca-ES")} · Pàgina {page} de {pageCount}</span>
    <span className="flex gap-2"><Link aria-disabled={page <= 1} className={`rounded-md border px-3 py-2 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={href(Math.max(1, page - 1))}>Anterior</Link><Link aria-disabled={page >= pageCount} className={`rounded-md border px-3 py-2 ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`} href={href(Math.min(pageCount, page + 1))}>Següent</Link></span>
  </nav>;
}

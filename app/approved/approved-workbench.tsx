"use client";
import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApprovedFilters, ApprovedPage } from "@/lib/approved-types";
import { FINANCING_TYPES, FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { TableActionLink, WorkPager, WorkTable } from "@/components/work-list";

const STORAGE_KEY = "mapeig-approved-selection";
export function ApprovedWorkbench({ result, filters }: { result: ApprovedPage; filters: ApprovedFilters }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { try { setSelected(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { setSelected([]); } }, 0); return () => window.clearTimeout(timer); }, []);
  const save = (values: string[]) => { setSelected(values); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values)); };
  const visible = result.provisions.map(row => row.id);
  const allVisible = !!visible.length && visible.every(id => selected.includes(id));
  const hiddenCount = selected.filter(id => !visible.includes(id)).length;
  async function exportSelected() {
    if (busy || !selected.length) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/exports/approved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provisionIds: selected }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "No s'ha pogut generar l'Excel."); }
      const blob = await response.blob();
      const name = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Detalle-Provisiones-Aprovats.xlsx";
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
      save([]); setMessage("Excel generat correctament.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error d'exportació."); }
    finally { setBusy(false); }
  }
  const origin = `/approved?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(result.page) })}`;
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><p className="page-eyebrow">Resultats · validació humana</p><h1 className="page-title">Aprovats</h1><p className="page-description">{result.total} provisions aprovades. Selecciona les que vulguis exportar.</p></div>
    <AutoFilterForm className="surface grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]"><input className="form-text" name="q" aria-label="Cercar provisions" defaultValue={filters.query} placeholder="Entitat, NIF, registre o codi…"/><select className="form-control !h-10" name="type" aria-label="Tipologia" defaultValue={filters.type}><option value="totes">Totes les tipologies</option>{FINANCING_TYPES.map(type => <option key={type} value={type}>{FINANCING_TYPE_LABELS[type]}</option>)}</select><button className="rounded-md bg-primary px-4 text-sm text-primary-foreground">Filtrar</button>{(filters.query || filters.type !== "totes") && <Link className="text-sm underline" href="/approved">Netejar filtres</Link>}</AutoFilterForm>
    <div className="surface flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex flex-wrap items-center gap-3"><button className="rounded-md border px-3 py-2 text-sm" onClick={() => save(allVisible ? selected.filter(id => !visible.includes(id)) : [...new Set([...selected, ...visible])])}>{allVisible ? "Desmarcar visibles" : "Seleccionar visibles"}</button><button className="text-sm underline" onClick={() => save([])}>Netejar selecció</button><span className="text-sm">{selected.length} seleccionats{hiddenCount ? ` · ${hiddenCount} en altres pàgines` : ""}</span></div><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!selected.length || busy} onClick={() => void exportSelected()}>{busy ? "Generant…" : "Exportar seleccionats"}</button></div>
    {message && <p role="status" className="status-success rounded-md border p-3 text-sm">{message}</p>}{error && <p role="alert" className="status-error rounded-md border p-3 text-sm">{error}</p>}
    <WorkTable headings={["", "Servei", "Entitat", "Import", "Decisió", "Lot", "Acció"]} empty={result.provisions.length ? undefined : "No hi ha provisions aprovades amb aquests filtres."}>
      {result.provisions.map(item => { const href = `/records/${item.sourceRecordId}?${new URLSearchParams({ from: origin, provision: item.id })}`; return <tr key={item.id}><td data-label="Seleccionar"><input type="checkbox" className="size-4" aria-label={`Seleccionar ${item.sourceId}`} checked={selected.includes(item.id)} onChange={event => save(event.target.checked ? [...new Set([...selected, item.id])] : selected.filter(id => id !== item.id))}/></td><td data-label="Servei"><Link className="font-semibold underline underline-offset-2" href={`/catalog/${item.serviceCode}?${new URLSearchParams({from:origin,...(item.catalogVersion?{version:item.catalogVersion}:{})})}`}>{item.serviceCode} · {item.serviceName}</Link><p className="mt-1 text-xs text-muted-foreground">{item.sourceId}{item.centre?` · ${item.centre}`:""}{item.period?` · ${item.period}`:""}{item.actType?` · ${item.actType}`:""}</p></td><td data-label="Entitat">{item.providerName ?? "No informada"}</td><td data-label="Import">{item.amount == null ? "—" : new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(item.amount)}</td><td data-label="Decisió"><span className="table-status status-success">{item.decision === "corrected" ? "Corregit" : "Aprovat"}</span></td><td data-label="Lot">{item.batchNumber ?? "—"}</td><td data-label="Acció"><TableActionLink href={href} label={`Veure el cas ${item.sourceId}`}/></td></tr>; })}
    </WorkTable><WorkPager href={page => `/approved?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(page) })}`} page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize}/>
  </section></main>;
}

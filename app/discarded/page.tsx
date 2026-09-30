import { AutoFilterForm } from "@/components/auto-filter-form";
import { WorkPager } from "@/components/work-list";
import { DiscardedSelection, PurgePending, type SelectableDiscard } from "./discarded-selection";
import { createServerSupabase } from "@/lib/records-page";
import { getCurrentResults } from "@/lib/current-results";
import { DISCARD_REASON_LABELS } from "@/lib/review-contract";
import { FINANCING_TYPE_LABELS } from "@/lib/financing-types";

export default async function DiscardedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const batchNumber = params.batch && /^\d+$/.test(params.batch) ? Number(params.batch) : undefined;
  const filters = { page, query: params.q?.slice(0, 120), type: params.type, reason: params.reason, batchNumber, destination: "discarded" };
  const result = await getCurrentResults(filters);
  const purges = await createServerSupabase().from("storage_purge_batches").select("id,record_count").is("completed_at", null).order("created_at", { ascending: false }).limit(100);
  if (purges.error) throw purges.error;
  function href(next: number) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value) query.set(key, value); query.set("page", String(next)); return `?${query}`; }
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><h1 className="text-2xl font-semibold">Descartats</h1><p className="mt-1 text-sm text-muted-foreground">Un descart automàtic no és una validació humana. Pots revisar i rectificar cada cas.</p></div>
    <AutoFilterForm className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><input name="q" aria-label="Cerca" defaultValue={params.q} placeholder="Títol o identificador" className="form-text"/><select name="reason" aria-label="Motiu" defaultValue={params.reason ?? ""} className="form-control"><option value="">Tots els motius</option>{Object.entries(DISCARD_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select name="type" aria-label="Tipologia" defaultValue={params.type ?? "totes"} className="form-control"><option value="totes">Totes les tipologies</option>{Object.entries(FINANCING_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input name="batch" inputMode="numeric" aria-label="Número del lot" defaultValue={params.batch} placeholder="Número del lot" className="form-control"/><button className="rounded bg-black px-4 py-2 text-white">Filtrar</button></AutoFilterForm>
    <PurgePending batches={purges.data ?? []}/><DiscardedSelection key={JSON.stringify(filters)} rows={result.rows as SelectableDiscard[]} origin={`/discarded${href(page)}`}/><WorkPager href={href} page={page} pageCount={result.pageCount} total={result.total} />
  </section></main>;
}

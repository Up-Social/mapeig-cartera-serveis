import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";
import { portfolioStatusLabel } from "@/lib/ui-labels";

export default async function MasterServicePage({ params, searchParams }: PageProps<"/catalog/master/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const origin = typeof query.from === "string" && query.from.startsWith("/catalog") && !query.from.startsWith("//") ? query.from : "/catalog?reference=master";
  const response = await createServerSupabase().from("master_services").select("id,service_code,service_name,sector_scope,portfolio_status,source_file,source_sheet,source_row,source_payload").eq("id", id).maybeSingle();
  if (response.error) throw response.error;
  const service = response.data;
  if (!service) notFound();
  return <main className="page-shell"><section className="page-container space-y-5"><Link className="text-sm underline" href={origin}>← Tornar al catàleg mestre</Link><div><p className="page-eyebrow">Catàleg mestre de referència · només lectura · {service.service_code}</p><h1 className="detail-title max-w-[75ch]">{service.service_name}</h1><p className="page-description">{portfolioStatusLabel(service.portfolio_status)} · {service.sector_scope}</p></div><section className="surface p-5"><h2 className="text-xl font-semibold">Origen i traçabilitat</h2><p className="mt-3 text-sm">{service.source_file ?? "Fitxer no informat"} · {service.source_sheet ?? "Full no informat"} · Fila {service.source_row ?? "—"}</p><section className="mt-5"><h3 className="text-sm font-semibold">Dades originals</h3><dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">{Object.entries(service.source_payload ?? {}).map(([key, value]) => <div key={key}><dt className="font-semibold text-muted-foreground">{key}</dt><dd className="break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl></section></section></section></main>;
}

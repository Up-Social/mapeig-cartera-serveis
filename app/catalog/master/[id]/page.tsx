import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";
import { portfolioStatusLabel } from "@/lib/ui-labels";
import { MasterReferenceData } from "@/components/master-reference-data";
import { DetailNavigation } from "@/components/detail-navigation";

export default async function MasterServicePage({ params, searchParams }: PageProps<"/catalog/master/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const origin = typeof query.from === "string" && query.from.startsWith("/catalog") && !query.from.startsWith("//") ? query.from : "/catalog?reference=master";
  const response = await createServerSupabase().from("master_services").select("*").eq("id", id).maybeSingle();
  if (response.error) throw response.error;
  const service = response.data;
  if (!service) notFound();
  return <main className="page-shell"><section className="page-container space-y-5">
    <DetailNavigation backHref={origin} backLabel="Tornar al catàleg mestre"/>
    <div><p className="page-eyebrow">Catàleg mestre de referència · només lectura · {service.service_code}</p><h1 className="detail-title">{service.service_name}</h1><p className="page-description">{portfolioStatusLabel(service.portfolio_status ?? "")} · {service.sector_scope || "Àmbit no informat"}</p></div>
    <section className="surface p-5"><h2 className="section-title">Origen i traçabilitat</h2><p className="mt-3 text-sm">{service.source_file ?? "Fitxer no informat"} · {service.source_sheet ?? "Full no informat"} · Fila {service.source_row ?? "—"}{service.storage_path && <> · <a className="underline" href={`/api/catalog/master/${id}/source`}>Descarrega el llibre original arxivat</a></>}</p></section>
    <MasterReferenceData payload={(service.source_payload ?? {}) as Record<string, unknown>}/>
  </section></main>;
}

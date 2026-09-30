import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";

export default async function EntityDetail({ params, searchParams }: PageProps<"/entities/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const origin = typeof query.from === "string" && query.from.startsWith("/entities") && !query.from.startsWith("//") ? query.from : "/entities";
  const db = createServerSupabase();
  const [entityResult, servicesResult, relationsResult, aliasesResult] = await Promise.all([
    db.from("entities").select("id,legal_name,nif,qualification,validation_status").eq("id", id).maybeSingle(),
    db.from("reses_services").select("registry_number,service_name,service_type,capacity,address,municipality,county,active").eq("entity_id", id).order("service_name"),
    db.from("entity_catalog_relations").select("service_code,relation_type,source_type,source_reference").eq("entity_id", id),
    db.from("entity_aliases").select("alias,source").eq("entity_id", id),
  ]);
  for (const result of [entityResult, servicesResult, relationsResult, aliasesResult]) if (result.error) throw result.error;
  const entity = entityResult.data;
  if (!entity) notFound();
  return <main className="page-shell"><section className="page-container space-y-5"><Link className="text-sm underline" href={origin}>← Tornar a Entitats</Link><div><p className="page-eyebrow">Referència · entitat</p><h1 className="page-title">{entity.legal_name}</h1><p className="page-description">{entity.nif ?? "NIF no informat"} · {entity.qualification ?? "Sense qualificació"} · {entity.validation_status}</p></div><div className="grid gap-5 lg:grid-cols-2"><section className="surface p-5"><h2 className="text-xl font-semibold">Serveis i establiments RESES</h2><p className="mt-1 text-sm text-muted-foreground">La relació RESES no acredita finançament.</p><ul className="mt-4 space-y-3">{(servicesResult.data ?? []).map(service => <li key={service.registry_number} className="rounded-md border p-3"><strong>{service.service_name}</strong><p className="text-sm">{service.registry_number} · {service.service_type} · {[service.address, service.municipality, service.county].filter(Boolean).join(", ")}</p></li>)}</ul></section><section className="surface p-5"><h2 className="text-xl font-semibold">Relació amb la Cartera</h2><ul className="mt-4 space-y-3">{(relationsResult.data ?? []).map((relation, index) => <li key={`${relation.service_code}-${index}`} className="rounded-md border p-3"><strong>{relation.service_code}</strong><p className="text-sm">{relation.relation_type === "confirmed" ? "Relació confirmada" : "Relació auxiliar"} · {relation.source_type}</p></li>)}</ul></section></div>{!!aliasesResult.data?.length && <section className="surface p-5"><h2 className="text-xl font-semibold">Àlies i fonts</h2><ul className="mt-3 space-y-2 text-sm">{aliasesResult.data.map((alias, index) => <li key={index}>{alias.alias} · {alias.source}</li>)}</ul></section>}</section></main>;
}

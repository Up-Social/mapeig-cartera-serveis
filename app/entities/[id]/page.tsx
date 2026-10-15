import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";
import { hasReferenceText, referenceTextLabel, entityQualificationLabel, catalogRelationSourceLabel, catalogRelationTypeLabel, entityValidationStatusLabel } from "@/lib/ui-labels";
import { DetailNavigation } from "@/components/detail-navigation";

export default async function EntityDetail({ params, searchParams }: PageProps<"/entities/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const origin = typeof query.from === "string" && query.from.startsWith("/entities") && !query.from.startsWith("//") ? query.from : "/entities";
  const db = createServerSupabase();
  const [entityResult, servicesResult, relationsResult, aliasesResult] = await Promise.all([
    db.from("entities").select("id,legal_name,nif,qualification,validation_status,active").eq("id", id).maybeSingle(),
    db.from("reses_services").select("registry_number,service_name,service_type,capacity,address,municipality,county,active").eq("entity_id", id).order("service_name"),
    db.from("entity_catalog_relations").select("service_code,relation_type,source_type,source_reference").eq("entity_id", id).is("retired_at", null),
    db.from("entity_aliases").select("alias,source").eq("entity_id", id),
  ]);
  for (const result of [entityResult, servicesResult, relationsResult, aliasesResult]) if (result.error) throw result.error;
  const entity = entityResult.data;
  if (!entity) notFound();
  if (!entity.active) {
    const audit=await db.from("reses_identity_operations").select("operation_key,kind,actor,created_at,before_state").eq("entity_id",id).eq("kind","repair").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(audit.error) throw audit.error;
    if(audit.data){
      const rows=(audit.data.before_state?.services??[]) as Array<{registry_number:string;service_name:string}>;
      return <main className="page-shell"><section className="page-container space-y-5"><DetailNavigation backHref="/entities" backLabel="Tornar a les entitats"/><div><p className="page-eyebrow">Historial de referència</p><h1 className="page-title">Agrupació sense titular · retirada</h1><p className="page-description">Aquesta agrupació es va crear perquè la font contenia «null» al nom i al NIF. No correspon a una entitat identificada.</p></div><section className="surface p-5"><h2 className="section-title">Dades conservades</h2><p className="mt-3">S’han conservat els {rows.length} serveis RESES, les dades originals i les observacions de tipologia. Cada servei es consulta individualment amb el seu historial de titularitat.</p><Link className="mt-3 inline-block underline" href="/entities/pending">Consultar els serveis amb titular pendent</Link><p className="mt-3 break-words text-sm">{audit.data.operation_key} · {audit.data.actor} · {audit.data.created_at}</p><ul className="mt-4 space-y-2">{rows.map(r=><li key={r.registry_number}><Link className="underline" href={`/entities/pending/${r.registry_number}`}>{r.registry_number} · {r.service_name}</Link></li>)}</ul></section></section></main>;
    }
  }
  return <main className="page-shell"><section className="page-container space-y-5"><DetailNavigation backHref={origin} backLabel="Tornar a les entitats"/><div><p className="page-eyebrow">Referència · entitat</p><h1 className="detail-title">{referenceTextLabel(entity.legal_name, "Entitat pendent d’identificar")}</h1><p className="page-description">{referenceTextLabel(entity.nif, "NIF no informat")} · {entityQualificationLabel(entity.qualification)} · {entityValidationStatusLabel(entity.validation_status)}</p>{(!hasReferenceText(entity.legal_name) || !hasReferenceText(entity.nif)) && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Identitat incompleta a la font. La verificació RESES no confirma el nom ni el NIF absents. Es conserven els serveis importats pendents de conciliació; no s’ha atribuït una identitat nova.</p>}</div><div className="card-panels"><section className="surface p-5"><h2 className="section-title">Serveis i establiments RESES</h2><p className="mt-1 text-sm text-muted-foreground">La relació RESES no acredita finançament.</p><ul className="mt-4 space-y-3 text-sm">{(servicesResult.data ?? []).map(service => <li key={service.registry_number} className="rounded-md border p-3"><strong>{service.service_name}</strong><p className="mt-1 text-sm">{service.registry_number} · {service.service_type} · {[service.address, service.municipality, service.county].filter(Boolean).join(", ")}</p></li>)}</ul></section><section className="surface p-5"><h2 className="section-title">Relació amb la Cartera</h2><ul className="mt-4 space-y-3 text-sm">{(relationsResult.data ?? []).map((relation, index) => <li key={`${relation.service_code}-${index}`} className="rounded-md border p-3"><strong>{relation.service_code}</strong><p className="mt-1 text-sm">Relació {catalogRelationTypeLabel(relation.relation_type)} · {catalogRelationSourceLabel(relation.source_type)}</p></li>)}</ul></section></div>{!!aliasesResult.data?.length && <section className="surface p-5"><h2 className="section-title">Àlies i fonts</h2><ul className="mt-3 space-y-2 text-sm">{aliasesResult.data.map((alias, index) => <li key={index}>{alias.alias} · {alias.source}</li>)}</ul></section>}</section></main>;
}

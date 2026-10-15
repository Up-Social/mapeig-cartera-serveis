import Link from "next/link";
import {notFound} from "next/navigation";
import {createServerSupabase} from "@/lib/records-page";
import {DetailNavigation} from "@/components/detail-navigation";
import {ResesIdentityProposals} from "@/components/reses-identity-proposals";
import type {ResesProposal} from "@/lib/reses-proposals";
import {referenceTextLabel} from "@/lib/ui-labels";

export default async function ResesReferencePage({params}: PageProps<"/entities/pending/[registry]">) {
  const {registry}=await params;
  if(!/^S[0-9]{5}$/.test(registry)) notFound();
  const db=createServerSupabase();
  const [service,history,observations,proposals]=await Promise.all([
    db.from("reses_services").select("*").eq("registry_number",registry).maybeSingle(),
    db.from("reses_holder_history").select("id,operation_key,actor,reason,before_state,after_state,created_at").eq("registry_number",registry).order("created_at",{ascending:false}),
    db.from("reses_catalog_observations").select("id,service_code,evidence,source_payload_hash,retired_at").eq("registry_number",registry),
    db.from("reses_identity_proposal_overview").select("*").eq("registry_number",registry).order("created_at",{ascending:false}),
  ]);
  for(const r of [service,history,observations,proposals]) if(r.error) throw r.error;
  const s=service.data;if(!s) notFound();
  return <main className="page-shell"><section className="page-container space-y-5">
    <DetailNavigation backHref="/entities/pending" backLabel="Tornar als titulars pendents"/>
    <div><p className="page-eyebrow">Referència · RESES {registry}</p><h1 className="detail-title">{s.service_name}</h1><p className="page-description">{s.service_type}</p></div>
    <section className="surface p-5"><h2 className="section-title">Titularitat</h2>{s.entity_id?<Link className="underline" href={`/entities/${s.entity_id}`}>Veure el titular identificat</Link>:<p className="mt-2 text-amber-900">Titular pendent d’identificar. Es conserva el servei i la font original; no s’ha atribuït a cap entitat sense evidència.</p>}<p className="mt-3 text-sm">La inscripció RESES i la correspondència de tipologia no acrediten finançament.</p></section>
    <ResesIdentityProposals proposals={(proposals.data??[]) as ResesProposal[]} sourceHash={s.source_payload_hash}/>
    <section className="surface p-5"><h2 className="section-title">Dades del servei</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{[["RESES",registry],["Municipi",s.municipality],["Comarca",s.county],["Adreça",s.address],["Capacitat",s.capacity],["Inscripció",s.registration_date],["Estat",s.active?"Actiu":"Inactiu"]].map(([label,value])=><div key={String(label)}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words">{value==null?"No informat":String(value)}</dd></div>)}</dl></section>
    <section className="surface p-5"><h2 className="section-title">Observacions de tipologia</h2><ul className="mt-3 space-y-3">{(observations.data??[]).map(o=><li key={o.id} className="rounded-md border p-3"><strong>{o.service_code}</strong><p>{o.evidence}</p><p className="text-sm text-muted-foreground">{o.retired_at?"Observació retirada; historial conservat":o.source_payload_hash!==s.source_payload_hash?"Font actualitzada · cal tornar a contrastar l’observació":"Relació auxiliar del servei · no atribuïda a un titular"}</p></li>)}</ul>{!observations.data?.length&&<p className="mt-2 text-sm">Sense correspondència de tipologia acreditada.</p>}</section>
    <section className="surface p-5"><h2 className="section-title">Font i historial</h2><a className="mt-3 inline-block underline" href={`https://analisi.transparenciacatalunya.cat/resource/ivft-vegh.json?${new URLSearchParams({"$where":`registre='${registry}'`})}`} target="_blank" rel="noreferrer">Consultar aquest RESES a la font oficial</a><p className="mt-3 break-all text-sm">SHA-256: {s.source_payload_hash}</p><p className="text-sm">Captura: {s.retrieved_at}</p>
    <ul className="mt-4 space-y-3">{(history.data??[]).map(h=><li key={h.id} className="rounded-md border p-3"><p className="font-semibold">{h.reason}</p><p className="text-sm">{h.actor} · {h.created_at}</p><p className="mt-1 text-sm">Titular anterior: {h.before_state?.entity_id??"Sense titular"} · Titular posterior: {h.after_state?.entity_id??"Pendent d’identificar"}</p><p className="text-sm">Operació: {h.operation_key??"Sincronització de la font"}</p></li>)}</ul>
    <details className="mt-4"><summary className="cursor-pointer font-semibold">Veure les dades originals de la font</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(s.source_payload??{}).map(([key,value])=><div key={key}><dt className="text-sm text-muted-foreground">{key}</dt><dd className="break-words">{referenceTextLabel(value==null?null:String(value))}</dd></div>)}</dl></details></section>
  </section></main>;
}

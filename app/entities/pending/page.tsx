import Link from "next/link";
import { pendingResesQuery } from "@/lib/reses-pending";
import { FilterForm } from "@/components/filter-form";
import { DetailNavigation } from "@/components/detail-navigation";
import { TableActionLink, WorkPager, WorkTable } from "@/components/work-list";

export default async function PendingResesPage({searchParams}: PageProps<"/entities/pending">) {
  const p=await searchParams;
  const q=typeof p.q==="string"?p.q:"";
  const county=typeof p.county==="string"&&p.county.trim()?p.county.trim():"totes";
  const requested=Math.max(1,Number.parseInt(String(p.page??"1"),10)||1);
  const countResult=await pendingResesQuery(q,county).range(0,0);
  if(countResult.error) throw countResult.error;
  const total=countResult.count??0,pageCount=Math.max(1,Math.ceil(total/25)),page=Math.min(requested,pageCount);
  const result=await pendingResesQuery(q,county).range((page-1)*25,page*25-1);
  if(result.error) throw result.error;
  const params=new URLSearchParams({q,county});
  return <main className="page-shell"><section className="page-container space-y-5">
    <DetailNavigation backHref="/entities" backLabel="Tornar a les entitats"/>
    <div><p className="page-eyebrow">Referència · RESES</p><h1 className="page-title">Titular pendent d’identificar</h1><p className="page-description">{total} serveis amb identitat pròpia al RESES. La font no acredita el seu titular; no s’agrupen com si fossin una única entitat. Aquesta referència no acredita finançament.</p></div>
    <FilterForm className="surface p-4"><input className="form-text" name="q" aria-label="Cercar servei RESES" placeholder="Codi, servei o municipi…" defaultValue={q}/><input className="form-text" name="county" aria-label="Comarca" defaultValue={county==="totes"?"":county}/><button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Aplicar filtres</button>{(q||county!=="totes")&&<Link className="underline" href="/entities/pending">Netejar filtres</Link>}</FilterForm>
    <a className="inline-block rounded-md border px-3 py-2 text-sm underline" href={`/api/entities/pending/export?${params}`}>Exportar serveis amb aquests filtres · CSV</a>
    <WorkTable profile="pendingReses" empty={total?undefined:"No hi ha serveis amb aquests filtres."}>{(result.data??[]).map(s=><tr key={s.registry_number}><td>{s.registry_number}</td><td><Link className="font-semibold" href={`/entities/pending/${s.registry_number}`}>{s.service_name}</Link></td><td>{s.service_type}</td><td>{[s.municipality,s.county].filter(Boolean).join(" · ")||"No informat"}</td><td>{s.active?"Titular pendent":"Servei inactiu · titular pendent"}</td><td><TableActionLink href={`/entities/pending/${s.registry_number}`} label={`Veure el servei ${s.registry_number}`}>Veure servei</TableActionLink></td></tr>)}</WorkTable>
    <WorkPager href={n=>`/entities/pending?${new URLSearchParams({q,county,page:String(n)})}`} page={page} pageCount={pageCount} total={total}/>
  </section></main>;
}

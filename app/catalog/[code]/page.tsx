import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOfficialCatalog } from "@/lib/official-catalog";
import { createServerSupabase } from "@/lib/records-page";
import { safeCatalogOrigin } from "@/lib/catalog-origin";
import { DetailNavigation } from "@/components/detail-navigation";
export default async function ServicePage({ params, searchParams }: PageProps<"/catalog/[code]">) {
 const {code}=await params;const query=await searchParams;
 const origin=safeCatalogOrigin(query.from);
 const catalog=await loadOfficialCatalog(createServerSupabase(),typeof query.version==='string'?query.version:undefined);
 const service=catalog.all.find(item=>item.service_code===code);if(!service)notFound();
 const children=catalog.all.filter(item=>item.parent_code===code);
 const eligible=catalog.eligible.some(item=>item.service_code===code);
 const fields=Object.entries(service.normative_fields??{}).filter(([,value])=>value?.trim());
 const href=(target:string)=>`/catalog/${target}?${new URLSearchParams({version:catalog.version.id,from:origin})}`;
 return <main className="page-shell"><section className="page-container space-y-5">
 <DetailNavigation backHref={origin} backLabel="Tornar al catàleg"/>
 <div><p className="page-eyebrow">Catàleg normatiu · {code}</p><h1 className="detail-title">{service.service_name}</h1><p className="page-description">{children.length?'Agrupador de prestacions · no assignable':eligible?'Servei final assignable':'Prestació no assignable a la correspondència de serveis'}</p><p className="mt-2 text-sm">Versió: {catalog.version.id}{!catalog.version.active?' · Versió històrica utilitzada en el resultat':''}</p></div>
 {service.parent_code&&<Link className="text-sm underline" href={href(service.parent_code)}>Veure agrupador {service.parent_code}</Link>}
 {children.length>0&&<section className="surface p-5"><h2 className="section-title">Prestacions d’aquest agrupador</h2><p className="mt-2 text-sm leading-6">La definició, la població destinatària i les condicions específiques consten a les fitxes de les prestacions.</p><ul className="mt-4 space-y-3 text-sm">{children.map(child=><li key={child.service_code}><Link className="underline" href={href(child.service_code)}>{child.service_code} · {child.service_name}</Link></li>)}</ul></section>}
 {(service.description||service.target_population||service.conditions)&&<div className="grid gap-5 lg:grid-cols-2">{[["Descripció",service.description],["Població destinatària",service.target_population],["Condicions d’accés",service.conditions]].filter(([,value])=>value).map(([label,value])=><section key={label} className="surface p-5"><h2 className="section-title">{label}</h2><p className="mt-3 whitespace-pre-line text-sm leading-6">{value}</p></section>)}</div>}
 {fields.length>0&&<section className="surface p-5"><h2 className="section-title">Fitxa normativa completa</h2><dl className="mt-4 grid gap-5 text-sm lg:grid-cols-2">{fields.map(([label,value])=><div key={label}><dt className="font-semibold">{label||'Altres disposicions'}</dt><dd className="mt-2 whitespace-pre-line leading-6">{value}</dd></div>)}</dl></section>}
 <a className="text-sm underline" href={service.legal_reference} target="_blank" rel="noreferrer">Consultar la font normativa de la fitxa</a>
 </section></main>;
}

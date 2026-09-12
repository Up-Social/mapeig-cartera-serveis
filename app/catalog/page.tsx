import Link from 'next/link';
import {loadOfficialCatalog} from '@/lib/official-catalog';
import {createServerSupabase} from '@/lib/records-page';
import { getMasterServicePage } from "@/lib/master-catalog";
import { CatalogWorkbench } from "./catalog-workbench";

type CatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const pageValue = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10,
  );
  const filters = {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
  };
  if(params.reference!=='master') {
    const catalog=await loadOfficialCatalog(createServerSupabase());
    const eligible=new Set(catalog.eligible.map(s=>s.service_code));
    const found=catalog.all.filter(s=>(s.service_code+' '+s.service_name).toLocaleLowerCase('ca').includes(filters.query.toLocaleLowerCase('ca')));
    const rows=found.slice((filters.page-1)*50,filters.page*50);
    return <main className="page-shell"><section className="page-container space-y-4"><h1 className="text-xl font-semibold">Catàleg normatiu de serveis</h1><p className="text-sm">Versió {catalog.version.version_date} · {catalog.eligible.length} serveis finals elegibles</p><p className="text-xs text-muted-foreground">{catalog.version.legal_notice}</p><Link href="?reference=master" className="text-sm underline">Consultar el Master de referència</Link><form className="flex gap-2"><input aria-label="Cercar servei" name="q" defaultValue={filters.query} className="min-w-0 flex-1 rounded border p-2"/><button className="rounded border px-4">Cercar</button></form>{rows.map(service=><details key={service.service_code} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{service.service_code} · {service.service_name}<span className="ml-2 text-xs text-muted-foreground">{eligible.has(service.service_code)?'Servei final':service.benefit_type==='service'?'Agrupador · no assignable':'Prestació exclosa del matching'}</span></summary><p className="mt-3 whitespace-pre-line text-sm">{service.description}</p><p className="mt-2 whitespace-pre-line text-sm">{service.target_population}</p><p className="mt-2 whitespace-pre-line text-sm">{service.conditions}</p><a className="mt-2 block text-xs underline" href={service.legal_reference}>Consultar norma · Annex 1, {service.service_code}</a></details>)}<nav className="flex gap-4">{filters.page>1&&<Link href={'?q='+encodeURIComponent(filters.query)+'&page='+(filters.page-1)}>Anterior</Link>}{filters.page*50<found.length&&<Link href={'?q='+encodeURIComponent(filters.query)+'&page='+(filters.page+1)}>Següent</Link>}</nav></section></main>;
  }
  const result = await getMasterServicePage(filters);
  return (
    <CatalogWorkbench
      result={result}
      filters={{ ...filters, page: result.page }}
    />
  );
}

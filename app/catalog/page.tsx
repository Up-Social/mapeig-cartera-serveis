import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { loadOfficialCatalog } from "@/lib/official-catalog";
import { createServerSupabase } from "@/lib/records-page";
import { getMasterServicePage } from "@/lib/master-catalog";
import { WorkPager, WorkTable } from "@/components/work-list";

export default async function CatalogPage({ searchParams }: PageProps<"/catalog">) {
  const params = await searchParams;
  const master = params.reference === "master";
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const query = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const origin = `/catalog?${new URLSearchParams({ ...(master ? { reference: "master" } : {}), q: query, page: String(page) })}`;
  let rows: { id: string; code: string; name: string; kind: string; description: string }[];
  let total: number; let pageCount: number;
  if (master) {
    const result = await getMasterServicePage({ page, query });
    rows = result.services.map(service => ({ id: service.id, code: service.serviceCode, name: service.serviceName, kind: service.portfolioStatus, description: service.sectorScope }));
    total = result.total; pageCount = result.pageCount;
  } else {
    const catalog = await loadOfficialCatalog(createServerSupabase());
    const eligible = new Set(catalog.eligible.map(service => service.service_code));
    const found = catalog.all.filter(service => `${service.service_code} ${service.service_name}`.toLocaleLowerCase("ca").includes(query.toLocaleLowerCase("ca")));
    total = found.length; pageCount = Math.max(1, Math.ceil(total / 25));
    rows = found.slice((page - 1) * 25, page * 25).map(service => ({ id: service.service_code, code: service.service_code, name: service.service_name, kind: eligible.has(service.service_code) ? "Servei final" : service.benefit_type === "service" ? "Agrupador · no assignable" : "Prestació exclosa del matching", description: service.target_population }));
  }
  return <main className="page-shell"><section className="page-container space-y-5"><div><p className="page-eyebrow">Referència · només lectura</p><h1 className="page-title">{master ? "Master de referència" : "Catàleg normatiu de serveis"}</h1><p className="page-description">{master ? "Catàleg auxiliar separat del procés de correspondència." : "Serveis de la Cartera i les seves condicions normatives."}</p></div>
    <nav className="flex gap-3 text-sm"><Link className={!master ? "font-semibold underline" : "underline"} href="/catalog">Catàleg normatiu</Link><Link className={master ? "font-semibold underline" : "underline"} href="/catalog?reference=master">Master</Link></nav>
    <AutoFilterForm className="surface flex flex-wrap gap-3 p-4">{master && <input type="hidden" name="reference" value="master"/>}<input className="form-text flex-1" name="q" aria-label="Cercar servei" defaultValue={query} placeholder="Codi o nom del servei…"/><button className="rounded-md bg-primary px-4 text-sm text-primary-foreground">Cercar</button>{query && <Link className="self-center text-sm underline" href={master ? "/catalog?reference=master" : "/catalog"}>Netejar filtres</Link>}</AutoFilterForm>
    <WorkTable headings={["Codi", "Servei", "Condició", "Àmbit", "Acció"]} empty={rows.length ? undefined : "No hi ha serveis amb aquests filtres."}>{rows.map(row => { const href = master ? `/catalog/master/${row.id}?${new URLSearchParams({ from: origin })}` : `/catalog/${encodeURIComponent(row.code)}?${new URLSearchParams({ from: origin })}`; return <tr key={row.id}><td data-label="Codi">{row.code}</td><td data-label="Servei"><Link className="font-semibold underline underline-offset-2" href={href}>{row.name}</Link></td><td data-label="Condició">{row.kind}</td><td data-label="Àmbit" className="max-w-[30ch]">{row.description}</td><td data-label="Acció"><Link className="inline-block rounded-md border px-3 py-2 text-sm" href={href}>Veure servei</Link></td></tr>; })}</WorkTable>
    <WorkPager href={next => `/catalog?${new URLSearchParams({ ...(master ? { reference: "master" } : {}), q: query, page: String(next) })}`} page={page} pageCount={pageCount} total={total}/>
  </section></main>;
}

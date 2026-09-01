"use client";
import Link from "next/link";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntityFilters, EntityPage } from "@/lib/entity-types";
import { cn } from "@/lib/utils";

export function EntitiesWorkbench({ result, filters }: { result: EntityPage; filters: EntityFilters }) {
  const href = (page: number) => `/entities?${new URLSearchParams({ page: String(page), q: filters.query, qualification: filters.qualification, county: filters.county })}`;
  return <main className="page-shell"><section className="page-container">
    <Badge variant="outline">Directori relacional · RESES</Badge>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight">Entitats</h1>
    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Entitats canòniques verificades per NIF exacte. RESES acredita titularitat i tipologia, però no acredita finançament.</p>
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Metric label="Entitats" value={result.metrics.total}/><Metric label="Serveis RESES" value={result.metrics.withReses}/><Metric label="Registres vinculats" value={result.metrics.linkedRecords}/><Metric label="Provisions confirmades" value={result.metrics.confirmed}/><Metric label="Mencions pendents" value={result.metrics.pendingMentions}/>
    </div>
    <section className="surface mt-6 overflow-hidden">
      <form className="grid gap-3 border-b bg-muted/30 p-4 md:grid-cols-[1fr_220px_220px_auto]">
        <Input name="q" defaultValue={filters.query} placeholder="Nom legal o NIF..." />
        <select name="qualification" defaultValue={filters.qualification} className="form-control"><option value="totes">Totes les qualificacions</option>{result.qualifications.map((x) => <option key={x}>{x}</option>)}</select>
        <select name="county" defaultValue={filters.county} className="form-control"><option value="totes">Totes les comarques</option>{result.counties.map((x) => <option key={x}>{x}</option>)}</select>
        <Button variant="outline">Filtrar</Button>
      </form>
      <StableAccordion stateKey="entities-records" className="divide-y" defaultValue={[]}>
        {result.entities.map((entity) => <AccordionItem key={entity.id} value={entity.id} className="px-4">
          <AccordionTrigger className="gap-4 py-4 hover:no-underline"><div className="min-w-0 flex-1"><div className="truncate font-semibold">{entity.legalName}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{entity.nif}</span><span>·</span><span>{entity.services.length} serveis RESES</span>{entity.qualification && <Badge variant="secondary">{entity.qualification}</Badge>}</div></div></AccordionTrigger>
          <AccordionContent className="pb-5"><div className="grid gap-5 border-t pt-4 lg:grid-cols-2">
            <section><h3 className="text-sm font-semibold">Identitat i àlies</h3><dl className="mt-3 grid grid-cols-[100px_1fr] gap-2 text-sm"><dt className="text-muted-foreground">NIF</dt><dd>{entity.nif}</dd><dt className="text-muted-foreground">Validació</dt><dd>{entity.validationStatus}</dd><dt className="text-muted-foreground">Àlies</dt><dd>{entity.aliases.map((x) => x.alias).filter((x) => x !== entity.legalName).join(" · ") || "Sense variants"}</dd></dl></section>
            <section><h3 className="text-sm font-semibold">Relació amb la Cartera</h3><p className="mt-2 text-sm text-muted-foreground">{entity.catalogRelations.length ? entity.catalogRelations.map((x) => `${x.serviceCode} · ${x.serviceName ?? ""} (${x.relationType})`).join("; ") : "Encara no hi ha relacions confirmades ni auxiliars."}</p></section>
          </div><section className="mt-5"><h3 className="text-sm font-semibold">Serveis i establiments RESES</h3><div className="mt-2 grid gap-2">{entity.services.map((s) => <div key={s.registryNumber} className="rounded-lg border p-3 text-sm"><div className="font-medium">{s.serviceName}</div><div className="mt-1 text-xs text-muted-foreground">{s.registryNumber} · {s.serviceType} · {[s.address, s.postalCode, s.municipality, s.county].filter(Boolean).join(", ")}{s.capacity != null ? ` · Capacitat ${s.capacity}` : ""}</div></div>)}</div></section></AccordionContent>
        </AccordionItem>)}
      </StableAccordion>
      <div className="flex items-center justify-between border-t p-4 text-sm"><span>{result.total.toLocaleString("ca-ES")} entitats</span><div className="flex items-center gap-2"><Link className={cn(buttonVariants({variant:"outline"}),result.page<=1&&"pointer-events-none opacity-40")} href={href(Math.max(1,result.page-1))}>Anterior</Link><span>{result.page} / {result.pageCount}</span><Link className={cn(buttonVariants({variant:"outline"}),result.page>=result.pageCount&&"pointer-events-none opacity-40")} href={href(Math.min(result.pageCount,result.page+1))}>Següent</Link></div></div>
    </section>
  </section></main>;
}
function Metric({label,value}:{label:string;value:number}) { return <div className="rounded-xl border bg-card p-4"><div className="text-xl font-semibold">{value.toLocaleString("ca-ES")}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div></div> }

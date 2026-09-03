"use client";

import Link from "next/link";
import { useRef } from "react";
import type {
  CatalogFilters,
  MasterService,
  MasterServicePage,
  ServiceProvision,
} from "@/lib/catalog-types";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { portfolioStatusLabel } from "@/lib/ui-labels";

export function CatalogWorkbench({
  result,
  filters,
}: {
  result: MasterServicePage;
  filters: CatalogFilters;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <main className="page-shell">
      <section className="page-container">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700">
              Catàleg mestre · només lectura
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Catàleg de serveis
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
              Consulta les files importades del catàleg mestre. Aquest catàleg està
              separat de la cua i no autoritza el seu ús per establir correspondències.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric label="Serveis totals" value={result.metrics.total} />
          <Metric label="Dins de la Cartera" value={result.metrics.inside} />
          <Metric label="Fora de la Cartera" value={result.metrics.outside} />
          <Metric label="Àmbits diferents" value={result.metrics.scopes} />
        </div>

        <div className="mt-6">
          <section className="surface overflow-hidden">
            <form ref={formRef} className="border-b border-neutral-200 bg-neutral-50 p-4">
              <Input
                name="q"
                defaultValue={filters.query}
                placeholder="Cercar codi, nom o àmbit..."
                aria-label="Cercar serveis"
                onChange={() => { if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => formRef.current?.requestSubmit(), 350); }}
              />
            </form>

            {result.services.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-500">
                No hi ha serveis que coincideixin amb els filtres.
              </p>
            ) : (
              <StableAccordion stateKey="catalog-services" className="divide-y">
                {result.services.map((service) => (
                  <AccordionItem key={service.id} value={service.id} className="px-4">
                    <AccordionTrigger className="gap-4 py-4 hover:no-underline">
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-muted-foreground">{service.serviceCode}</span><StatusBadge status={service.portfolioStatus} /></div>
                        <p className="mt-1 font-medium leading-5">{service.serviceName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{service.sectorScope}</p>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="border-t pb-5 pt-4"><ServiceDetail service={service} embedded /></AccordionContent>
                  </AccordionItem>
                ))}
              </StableAccordion>
            )}
            <Pagination result={result} filters={filters} />
          </section>
        </div>
      </section>
    </main>
  );
}

function Pagination({
  result,
  filters,
}: {
  result: MasterServicePage;
  filters: CatalogFilters;
}) {
  const href = (page: number) =>
    `/catalog?${new URLSearchParams({ page: String(page), q: filters.query })}`;
  const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const end = Math.min(result.page * result.pageSize, result.total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-4 text-sm sm:flex-row sm:px-5">
      <span className="text-neutral-500">
        {start}–{end} de {result.total.toLocaleString("ca-ES")}
      </span>
      <div className="flex items-center gap-1 sm:gap-2">
        <Link
          aria-disabled={result.page <= 1}
          href={href(Math.max(1, result.page - 1))}
          className={cn(
            buttonVariants({ variant: "outline" }),
            result.page <= 1 && "pointer-events-none opacity-40",
          )}
        >
          Anterior
        </Link>
        <span className="px-2 py-2 text-neutral-600">
          {result.page} / {result.pageCount}
        </span>
        <Link
          aria-disabled={result.page >= result.pageCount}
          href={href(Math.min(result.pageCount, result.page + 1))}
          className={cn(
            buttonVariants({ variant: "outline" }),
            result.page >= result.pageCount && "pointer-events-none opacity-40",
          )}
        >
          Següent
        </Link>
      </div>
    </div>
  );
}

function ServiceDetail({
  service,
  embedded = false,
}: {
  service?: MasterService;
  embedded?: boolean;
}) {
  if (!service)
    return (
      <aside className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500">
        Selecciona uns altres filtres per veure serveis.
      </aside>
    );
  const payload = Object.entries(service.sourcePayload).filter(
    ([key, value]) =>
      !key.startsWith("Fórmula ·") && value !== null && value !== "",
  );
  return (
    <aside
      className={
        embedded ? "bg-white" : "surface self-start p-5 xl:sticky xl:top-20"
      }
    >
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-600">
        Detall del servei
      </p>
      <p className="mt-3 text-sm font-semibold text-neutral-500">
        {service.serviceCode}
      </p>
      <h2 className="mt-1 text-lg font-semibold leading-snug">
        {service.serviceName}
      </h2>
      <div className="mt-3">
        <StatusBadge status={service.portfolioStatus} />
      </div>
      <dl className="mt-5 grid gap-3 border-y border-neutral-200 py-5 text-sm">
        <Detail label="Àmbit" value={service.sectorScope} />
        <Detail
          label="Confiança"
          value={formatConfidence(service.generalConfidence)}
        />
        <Detail label="Fitxer" value={service.sourceFile ?? "—"} />
        <Detail label="Full" value={service.sourceSheet ?? "—"} />
        <Detail
          label="Fila original"
          value={service.sourceRow?.toLocaleString("ca-ES") ?? "—"}
        />
      </dl>
      <section className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Provisions vinculades
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Dades operatives desades a Supabase
            </p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold">
            {service.provisions.length}
          </span>
        </div>
        {service.provisions.length > 0 ? (
          <div className="mt-3 max-h-[36rem] space-y-3 overflow-auto pr-1">
            {service.provisions.map((provision) => (
              <ProvisionCard key={provision.id} provision={provision} />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
            <p className="text-sm font-semibold">
              Encara no hi ha provisions vinculades
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              Apareixeran aquí quan el registre font tingui un codi de Cartera
              validat. El catàleg mestre no s&apos;utilitza per generar aquestes dades.
            </p>
          </div>
        )}
      </section>
      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <EntityRelations title="Entitats confirmades" items={service.entityRelations.filter((item) => item.relationType === "confirmed")} empty="Cap provisió aprovada vinculada per NIF exacte." />
        <EntityRelations title="Compatibilitats RESES" items={service.entityRelations.filter((item) => item.relationType === "auxiliary")} empty="Cap compatibilitat auxiliar per tipologia exacta." />
      </section>
      <details className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Dades originals d&apos;auditoria
        </summary>
        <p className="mt-2 text-xs leading-5 text-neutral-500">
          Metadades importades del catàleg. Les fórmules del llibre no es
          mostren.
        </p>
        <dl className="mt-4 max-h-80 space-y-3 overflow-auto pr-2 text-xs">
          {payload.map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold text-neutral-500">{key}</dt>
              <dd className="mt-1 break-words leading-5 text-neutral-700">
                {formatPayloadValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}

function EntityRelations({ title, items, empty }: { title: string; items: MasterService["entityRelations"]; empty: string }) {
  return <div className="rounded-xl border p-4"><h3 className="text-sm font-semibold">{title}</h3>{items.length ? <div className="mt-2 grid gap-2">{items.map((item) => <Link key={`${item.entityId}-${item.sourceReference}`} href={`/entities?q=${encodeURIComponent(item.nif ?? item.legalName)}`} className="text-sm underline underline-offset-2">{item.legalName}{item.nif ? ` · ${item.nif}` : ""}</Link>)}</div> : <p className="mt-2 text-xs text-muted-foreground">{empty}</p>}<p className="mt-2 text-[13.2px] text-muted-foreground">{title.includes("RESES") ? "Relació auxiliar: no prova finançament." : "Relació confirmada mitjançant una provisió aprovada."}</p></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 p-4 sm:p-5">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {value.toLocaleString("ca-ES")}
      </p>
    </Card>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-neutral-800">
        {value}
      </dd>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const inside = status === "Dentro";
  return (
    <Badge variant={inside ? "default" : "secondary"}>
      {statusLabel(status)}
    </Badge>
  );
}
function ProvisionCard({ provision }: { provision: ServiceProvision }) {
  return (
    <article className="rounded-xl border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-neutral-500">
            {provision.sourceId}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {provision.providerName ?? "Entitat no informada"}
          </p>
        </div>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold">
          {provision.mechanism}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-xs">
        <Detail label="NIF" value={provision.providerNif ?? "—"} />
        <Detail label="Data" value={formatDate(provision.awardDate)} />
        <Detail label="Import" value={formatMoney(provision.amount)} />
        <Detail label="Òrgan" value={provision.contractingBody ?? "—"} />
        <Detail label="Població" value={provision.targetPopulation ?? "—"} />
        <Detail label="Font" value={provision.sourceReference} />
      </dl>
      {(provision.callUrl || provision.regulatoryBasisUrl) && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {provision.callUrl && (
            <a
              href={provision.callUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Convocatòria
            </a>
          )}
          {provision.regulatoryBasisUrl && (
            <a
              href={provision.regulatoryBasisUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Bases reguladores
            </a>
          )}
        </div>
      )}
    </article>
  );
}
function statusLabel(status: string) {
  return portfolioStatusLabel(status);
}
function formatConfidence(value: number | null) {
  if (value == null) return "No informada";
  return value <= 1 ? `${Math.round(value * 100)}%` : `${value}%`;
}
function formatPayloadValue(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "No informat";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function formatMoney(value: number | null) {
  return value == null
    ? "No informat"
    : new Intl.NumberFormat("ca-ES", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(value);
}
function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ca-ES").format(new Date(`${value}T00:00:00`));
}

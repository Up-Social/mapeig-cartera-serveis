import { ArrowRight, CheckCircle2, CircleAlert, Database, FileSearch, GitCompareArrows, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const pipeline = [
  ["1", "Captació", "Importació del registre amb identificador, tipologia, font i contingut original."],
  ["2", "Preparació", "Localització de documents, extracció de text i creació de fragments auditables."],
  ["3", "Contrast", "Extracció de dades únicament des de les fonts oficials, amb evidències citades."],
  ["4", "Correspondència", "Proposta de fins a tres serveis de la Cartera, amb puntuació i justificació."],
  ["5", "Revisió", "Decisió humana: aprovar, corregir, rebutjar o declarar evidència insuficient."],
  ["6", "Resultat", "Creació de la provisió només després d’una aprovació o correcció."],
] as const;

const sections = [
  {
    name: "Registres",
    state: "Entrada i procés individual",
    body: "Permet consultar, filtrar i processar un cas. Un error documental, de contrast o de correspondència l’envia automàticament a Incidències.",
    next: "Revisió o Incidències",
  },
  {
    name: "Lots",
    state: "Procés automàtic d’1 a 50 casos",
    body: "Executa preparació, contrast i correspondència sense aturar els casos correctes quan un altre falla. Cada error queda visible al lot i a Incidències.",
    next: "Revisió o Incidències",
  },
  {
    name: "Revisió",
    state: "Decisió humana obligatòria",
    body: "Aprovar o corregir crea una provisió. Rebutjar o indicar evidència insuficient exigeix un motiu i trasllada el cas a Incidències.",
    next: "Aprovats o Incidències",
  },
  {
    name: "Incidències",
    state: "Resolució i seguiment",
    body: "Agrupa errors tècnics i decisions negatives. Permet reintentar la fase afectada o tornar a Revisió per rectificar la decisió.",
    next: "Revisió o procés",
  },
  {
    name: "Aprovats",
    state: "Provisions vigents",
    body: "Mostra només decisions positives amb provisió activa. Permet seleccionar i exportar els resultats sense modificar el Master original.",
    next: "Exportació",
  },
] as const;

const sources = [
  {
    type: "Contractació pública",
    registry: "PSCP",
    records: "Expedients, adjudicacions i formalitzacions",
    documents: "Publicació, perfil del contractant, plecs i formalització.",
  },
  {
    type: "Conveni",
    registry: "Registre de Convenis",
    records: "Convenis i addendes",
    documents: "Document del conveni, objecte, parts, aportacions i annexos.",
  },
  {
    type: "Subvenció",
    registry: "RAISC · Generalitat i ens locals",
    records: "Concessions i convocatòries",
    documents: "Convocatòria, resolució, publicació i bases reguladores.",
  },
  {
    type: "Concert social / gestió delegada",
    registry: "e-Tauler",
    records: "305 actes únics de 2024–2026",
    documents: "Anunci, DOGC, resolució i annexos disponibles.",
  },
] as const;

export default function ProcessPage() {
  return (
    <main className="page-shell">
      <section className="page-container max-w-[1240px]">
        <p className="page-eyebrow">Funcionament i traçabilitat</p>
        <h1 className="page-title">Procés</h1>
        <p className="page-description">
          Resum del pipeline, les decisions humanes i les fonts que alimenten el mapeig de la Cartera de serveis socials.
        </p>

        <section className="surface mt-7 p-4 sm:p-6">
          <SectionHeading icon={GitCompareArrows} title="1. Pipeline de principi a fi" description="La proposta automàtica mai es converteix directament en una provisió: sempre passa per revisió humana." />
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pipeline.map(([number, title, body], index) => (
              <article key={number} className="relative rounded-xl border bg-background p-4">
                <div className="flex items-center gap-3"><span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{number}</span><h3 className="font-semibold">{title}</h3></div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
                {index < pipeline.length - 1 && <ArrowRight className="absolute -right-2.5 top-5 z-10 hidden size-5 rounded-full bg-card p-0.5 text-muted-foreground xl:block" aria-hidden="true" />}
              </article>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <FlowRule icon={CheckCircle2} label="Decisió positiva" text="Aprovat o corregit → provisió vigent." />
            <FlowRule icon={CircleAlert} label="Decisió negativa" text="Rebutjat o evidència insuficient → Incidències." />
            <FlowRule icon={FileSearch} label="Error tècnic" text="Preparació, contrast o matching → Incidències." />
          </div>
        </section>

        <section className="surface mt-6 p-4 sm:p-6">
          <SectionHeading icon={ListChecks} title="2. Flux funcional i d’aprovacions" description="Cada apartat té una responsabilitat clara i un destí possible per al registre." />
          <div className="mt-5 overflow-hidden rounded-xl border">
            <div className="hidden grid-cols-[150px_220px_1fr_170px] gap-4 bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Apartat</span><span>Funció</span><span>Regla de decisió</span><span>Destí</span></div>
            <div className="divide-y">
              {sections.map((section) => (
                <article key={section.name} className="grid gap-2 p-4 md:grid-cols-[150px_220px_1fr_170px] md:gap-4">
                  <h3 className="font-semibold">{section.name}</h3>
                  <p className="text-sm text-foreground">{section.state}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{section.body}</p>
                  <div><Badge variant="secondary">{section.next}</Badge></div>
                </article>
              ))}
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">Les decisions es conserven com a historial. Rectificar una decisió actualitza o retira la provisió vigent, però no elimina la traçabilitat anterior.</p>
        </section>

        <section className="surface mt-6 p-4 sm:p-6">
          <SectionHeading icon={Database} title="3. Registre de fonts" description="Cada fila conserva la procedència original. Els documents són evidències vinculades al registre, no registres independents." />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {sources.map((source) => (
              <Card key={source.type} className="gap-0 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{source.type}</h3><Badge variant="outline">{source.registry}</Badge></div>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registres</dt><dd className="mt-1">{source.records}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidència documental</dt><dd className="mt-1 leading-6 text-muted-foreground">{source.documents}</dd></div>
                </dl>
              </Card>
            ))}
          </div>
          <aside className="mt-4 rounded-xl bg-muted p-4 text-sm leading-6"><strong>RESES és una font auxiliar transversal.</strong> Ajuda a contrastar entitats, establiments, tipologies, territori i capacitat, però no demostra per si sola que una provisió financi un servei concret. BDNS continua pendent de connexió.</aside>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card className="gap-0 p-5"><h2 className="font-semibold">Traçabilitat conservada</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Dataset, identificador original, fitxer o URL, full i fila, payload original, documents, fragments, dades contrastades, candidats, model, decisió, motiu i provisió final.</p></Card>
          <Card className="gap-0 p-5"><h2 className="font-semibold">Límits actuals</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Els documents sense text necessiten OCR. El matching utilitza el catàleg Master aïllat i autoritzat; no utilitza les seves fórmules ni provisions manuals com a evidència.</p></Card>
        </section>
      </section>
    </main>
  );
}

function SectionHeading({ icon: Icon, title, description }: { icon: typeof Database; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div></div>;
}

function FlowRule({ icon: Icon, label, text }: { icon: typeof CheckCircle2; label: string; text: string }) {
  return <div className="rounded-xl bg-muted/70 p-3"><div className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" aria-hidden="true" />{label}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>;
}

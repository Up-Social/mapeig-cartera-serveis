import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const types = [
  {
    name: "Subvenció",
    status: "Disponible",
    sources: [
      "RAISC · Generalitat (full CCAA)",
      "RAISC · administracions locals (full Local)",
      "BDNS · prevista, encara no connectada",
    ],
    documents:
      "Convocatòria, resolució, bases reguladores i publicació oficial enllaçades al registre.",
  },
  {
    name: "Conveni",
    status: "Disponible",
    sources: [
      "Registre de Convenis de Catalunya",
      "Document del conveni i annexos",
    ],
    documents:
      "Text del conveni, objecte, parts, aportacions, vigència i annexos disponibles.",
  },
  {
    name: "Contractació pública",
    status: "Disponible",
    sources: [
      "Plataforma de Serveis de Contractació Pública (PSCP)",
      "Perfil del contractant i publicacions vinculades",
    ],
    documents:
      "Anunci, adjudicació, formalització, plecs i documentació d’execució quan estiguin disponibles.",
  },
  {
    name: "Concert social / gestió delegada",
    status: "Disponible · 305 actes",
    sources: [
      "e-Tauler · cerca literal «concert social»",
      "DOGC i resolucions enllaçades als anuncis",
    ],
    documents:
      "El connector ha importat 305 actes únics de 2024-2026 que contenen literalment «concert social». Es tracten com esdeveniments diferenciats: alta o ampliació, pròrroga, modificació, autorització de despesa, cessió, esmena, baixa o resolució anticipada.",
  },
];

const steps = [
  [
    "1",
    "Captació",
    "S’importa o consulta el registre públic i es conserva la seva procedència: tipologia, font interna, identificador, fitxer o URL, data i contingut original.",
  ],
  [
    "2",
    "Control de duplicats",
    "Es calcula una identitat normalitzada amb tipologia, títol, entitat i import. No se selecciona un cas si ell mateix o una variant equivalent ja ha entrat en un lot.",
  ],
  [
    "3",
    "Lot automàtic",
    "Se seleccionen entre 1 i 50 casos de manera atòmica i equilibrada. El mateix registre o una identitat equivalent no pot entrar simultàniament en dos lots.",
  ],
  [
    "4",
    "Preparació de fonts",
    "El processador persistent localitza les adreces, descarrega els documents, n’extreu el text i crea fragments amb qualitat i traçabilitat. Els casos sense font o amb format no compatible acaben amb una incidència explícita.",
  ],
  [
    "5",
    "Contrast de dades",
    "La IA extreu únicament dels fragments oficials els camps contrastats —entitat, NIF, mecanisme, data, import, organisme i col·lectiu— i cita els fragments que els sustenten.",
  ],
  [
    "6",
    "Matching",
    "Els fragments oficials es contrasten amb el catàleg autoritzat. El model proposa fins a tres serveis ordenats, amb puntuació, justificació i evidència; no pot inventar codis.",
  ],
  [
    "7",
    "Validació humana",
    "La persona revisora aprova, corregeix, rebutja o declara evidència insuficient. Només una decisió positiva crea o actualitza una provisió.",
  ],
  [
    "8",
    "Exportació",
    "Supabase és la font de veritat. Les provisions aprovades s’escriuen en un Excel nou; es poden seleccionar les visibles o totes les que compleixen els filtres, sense modificar el catàleg mestre original.",
  ],
];

const workflowStates = [
  ["Registre", "pendent → preparant → preparat → processant → revisio → completat o rebutjat"],
  ["Fases", "pendent/preparant/preparada per a l’evidència; pendent/processant/completada per al contrast"],
  ["Registre del procés", "seleccionat → preparant → preparat → fent correspondència → pendent de revisió → decisió humana"],
  ["Lot", "en cua → preparant → contrastant → fent correspondència → pendent de revisió → completat"],
  ["Processador", "en cua → en execució → completada o fallida, amb senyal de vida i fins a 3 intents"],
];

const auditFindings = [
  ["Corregit", "Les 3 correspondències incompletes s’han regenerat: tots els candidats tenen evidència oficial enllaçada."],
  ["Corregit", "Els 27.732 errors documentals heretats s’han normalitzat sense ocultar els intents reals."],
  ["Corregit", "Els estats històrics i els timestamps de processament i revisió ja tenen una semàntica coherent."],
  ["Protegit", "La base de dades restringeix els estats, fases, preparació i tipologies admesos pel flux."],
  ["Revisió", "865 files formen 351 clústers d’identitat potencialment duplicada; no s’eliminen perquè poden ser actes legítims."],
];

export default function ProcessPage() {
  return (
    <main className="page-shell">
      <section className="page-container max-w-[1200px]">
        <p className="page-eyebrow">Metodologia i traçabilitat</p>
        <h2 className="page-title">Procés</h2>
        <p className="page-description">
          Aquesta pàgina descriu el flux operatiu real i l&apos;estat auditat del PoC. Una tipologia és
          un mecanisme de finançament; cada tipologia pot contenir diverses
          fonts públiques i documents.
        </p>
        <section className="surface mt-7 p-4 sm:p-5">
          <h3 className="text-lg font-semibold">
            Tipologies i fonts consultades
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {types.map((type) => (
              <Card key={type.name} className="gap-0 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold">{type.name}</h4>
                  <Badge variant="secondary">{type.status}</Badge>
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Fonts internes
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {type.sources.map((source) => (
                    <li key={source}>· {source}</li>
                  ))}
                </ul>
                <p className="mt-3 text-sm leading-6 text-neutral-600">
                  {type.documents}
                </p>
              </Card>
            ))}
          </div>
          <aside className="mt-4 rounded-xl bg-neutral-100 p-4 text-sm leading-6">
            <strong>Font auxiliar transversal: RESES.</strong> Serveix per
            comprovar entitats, establiments, tipologies, territori i capacitat.
            No demostra per si sol que una provisió financi un servei concret.
          </aside>
        </section>
        <section className="surface mt-6 p-4 sm:p-5">
          <h3 className="text-lg font-semibold">Estats persistents i transicions</h3>
          <div className="mt-4 divide-y">
            {workflowStates.map(([entity, transition]) => (
              <div key={entity} className="grid gap-2 py-3 sm:grid-cols-[150px_1fr]">
                <strong className="text-sm">{entity}</strong>
                <code className="break-words text-xs leading-6 text-neutral-600">{transition}</code>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-neutral-500">Els fluxos antics poden conservar draft, ready, selection o confirmation. La revisió humana continua sent obligatòria i és independent del resultat automàtic.</p>
        </section>
        <section className="surface mt-6 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Auditoria d’integritat · 2 de setembre de 2026</h3><p className="mt-1 text-sm text-neutral-600">28.124 registres i 25 taules revisats íntegrament, sense modificar dades.</p></div><Badge variant="outline">No destructiva</Badge></div>
          <div className="mt-4 space-y-3">{auditFindings.map(([level, finding]) => <div key={finding} className="rounded-xl border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{level}</p><p className="mt-1 text-sm leading-6">{finding}</p></div>)}</div>
          <p className="mt-4 text-sm leading-6 text-neutral-600">No s’han detectat relacions òrfenes, evidències creuades entre registres, codis de servei inexistents, provisions sense revisió positiva ni recomptes de lot incorrectes. Les correccions recomanades estan documentades a <code>docs/DATA_INTEGRITY_AUDIT.md</code> i no s’han aplicat.</p>
        </section>
        <section className="surface mt-6 p-4 sm:p-5">
          <h3 className="text-lg font-semibold">
            Del registre a la provisió aprovada
          </h3>
          <div className="mt-5 space-y-4">
            {steps.map(([number, title, body]) => (
              <article
                key={number}
                className="grid gap-3 border-b border-neutral-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-[42px_180px_1fr]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                  {number}
                </span>
                <h4 className="pt-1.5 font-semibold">{title}</h4>
                <p className="text-sm leading-6 text-neutral-600">{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card className="gap-0 p-5">
            <h3 className="font-semibold">Com s’escull el servei ara</h3>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-neutral-600">
              <li>1. Es preparen els fragments del document oficial.</li>
              <li>
                2. S’envien aquests fragments i els 140 serveis autoritzats al
                model.
              </li>
              <li>
                3. El model retorna fins a tres candidats ordenats, amb
                justificació i fragments.
              </li>
              <li>4. Els codis inexistents es descarten.</li>
              <li>
                5. La persona revisora pren la decisió final o busca un altre
                servei.
              </li>
            </ol>
            <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-xs leading-5">
              La reducció prèvia mitjançant regles, CPV, RESES i similitud
              semàntica forma part de l’arquitectura prevista, però encara no
              està implementada en aquest PoC.
            </p>
          </Card>
          <Card className="gap-0 p-5">
            <h3 className="font-semibold">Límits actuals del PoC</h3>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              Actualment hi ha registres importats de RAISC, convenis, PSCP i
              e-Tauler. La preparació documental s’executa per registre quan entra
              al procés automàtic; molts documents continuen només descoberts. BDNS,
              RESES i la reconstrucció del catàleg des de la font pública
              oficial continuen pendents. La correspondència actual utilitza el catàleg
              mestre aïllat perquè va ser autoritzat explícitament; no utilitza
              les seves fórmules ni provisions manuals com a evidència.
            </p>
          </Card>
        </section>
      </section>
    </main>
  );
}

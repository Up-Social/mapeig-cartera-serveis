import { getAutomaticOcrSetting } from "@/lib/admin-settings";
import { getAiCostSummary } from "@/lib/records-page";
import { OcrSetting } from "./ocr-setting";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [setting,aiCosts] = await Promise.all([getAutomaticOcrSetting(),getAiCostSummary()]);

  return (
    <main className="page-shell">
      <section className="page-container space-y-5">
        <div>
          <p className="page-eyebrow">Administració</p>
          <h1 className="page-title">Administració</h1>
          <p className="page-description">
            Configura el processament i consulta el cost de la IA.
          </p>
        </div>
        <OcrSetting initialSetting={setting} />
        <section className="surface p-5" aria-labelledby="ai-cost-title" data-testid="ai-cost-summary">
          <h2 id="ai-cost-title" className="text-lg font-semibold">Cost mitjà de processament amb IA</h2>
          <p className="mt-1 text-sm text-muted-foreground">Estimació per registre a partir dels tokens d’IA registrats i la tarifa configurada; no és una factura del proveïdor ni l’import del concert.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(['concert','altres'] as const).map(scope=>{
              const cost=aiCosts.find(item=>item.scope===scope);
              return <div key={scope} className="rounded-lg border bg-muted/20 p-4"><p className="text-sm font-semibold">{scope==='concert'?'Concerts':'Altres tipologies'}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{cost?new Intl.NumberFormat('ca-ES',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:5}).format(cost.averageUsd):'Sense dades'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{cost?`${cost.measuredRecords} registres amb ús mesurat`:'Encara no hi ha cap ús mesurat'}</p>
              </div>;
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Mitjana de totes les execucions atribuïbles a cada registre amb cost calculat. Els registres sense ús confirmat queden fora; no inclou OCR local, infraestructura ni revisió humana.</p>
        </section>
      </section>
    </main>
  );
}

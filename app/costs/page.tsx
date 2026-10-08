import { getAiCostSummary } from "@/lib/records-page";
import { getEcbDollarRate } from "@/lib/ecb-rate";
import { AiCostPanel } from "./ai-cost-panel";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const [aiCosts, euroRate] = await Promise.all([getAiCostSummary(), getEcbDollarRate()]);

  return (
    <main className="page-shell">
      <section className="page-container space-y-5">
        <div>
          <p className="page-eyebrow">Seguiment econòmic</p>
          <h1 className="page-title">Costos</h1>
          <p className="page-description">Consulta la despesa acumulada de processament amb IA i la mitjana per registre.</p>
        </div>
        <AiCostPanel initialSummary={aiCosts} initialRate={euroRate} />
      </section>
    </main>
  );
}

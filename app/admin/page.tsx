import { getAutomaticOcrSetting } from "@/lib/admin-settings";
import { getAiCostSummary } from "@/lib/records-page";
import { getEcbDollarRate } from "@/lib/ecb-rate";
import { AiCostPanel } from "./ai-cost-panel";
import { OcrSetting } from "./ocr-setting";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [setting,aiCosts,euroRate] = await Promise.all([getAutomaticOcrSetting(),getAiCostSummary(),getEcbDollarRate()]);

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
        <AiCostPanel initialSummary={aiCosts} initialRate={euroRate} />
      </section>
    </main>
  );
}

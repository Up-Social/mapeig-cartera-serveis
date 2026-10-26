import { getAutomaticOcrSetting } from "@/lib/admin-settings";
import { OcrSetting } from "./ocr-setting";
import {ProcessingSetting} from './processing-setting';
import {getProcessingSetting} from '@/lib/processing-control';
import {createServerSupabase} from '@/lib/records-page';

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [setting, processing] = await Promise.all([getAutomaticOcrSetting(), getProcessingSetting(createServerSupabase())]);

  return (
    <main className="page-shell">
      <section className="page-container space-y-5">
        <div>
          <p className="page-eyebrow">Administració</p>
          <h1 className="page-title">Administració</h1>
          <p className="page-description">
            Configura el processament automàtic.
          </p>
        </div>
        <ProcessingSetting initialSetting={processing} />
        <OcrSetting initialSetting={setting} />
      </section>
    </main>
  );
}

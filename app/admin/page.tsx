import { getAutomaticOcrSetting } from "@/lib/admin-settings";
import { OcrSetting } from "./ocr-setting";
import {ProcessingSetting} from './processing-setting';
import {getProcessingSetting} from '@/lib/processing-control';
import {createServerSupabase} from '@/lib/records-page';
import {loadPausedTaskSummary} from '@/lib/cloud/paused-task-summary';
import {PausedTasks} from './paused-tasks';

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const db = createServerSupabase();
  const [setting, processing, pauses] = await Promise.all([
    getAutomaticOcrSetting(), getProcessingSetting(db),
    loadPausedTaskSummary(db).catch(() => null),
  ]);

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
        <PausedTasks summary={pauses} />
        <OcrSetting initialSetting={setting} />
      </section>
    </main>
  );
}

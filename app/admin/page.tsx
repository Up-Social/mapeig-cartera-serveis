import { getAutomaticOcrSetting } from "@/lib/admin-settings";
import { OcrSetting } from "./ocr-setting";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const setting = await getAutomaticOcrSetting();

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
        <OcrSetting initialSetting={setting} />
      </section>
    </main>
  );
}

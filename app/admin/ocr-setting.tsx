"use client";

import { useState, useTransition } from "react";
import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutomaticOcrSetting } from "@/lib/admin-settings";

export function OcrSetting({ initialSetting }: { initialSetting: AutomaticOcrSetting }) {
  const [setting, setSetting] = useState(initialSetting);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle() {
    const enabled = !setting.enabled;
    setMessage("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/settings/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        const payload = (await response.json()) as { setting?: AutomaticOcrSetting; error?: string };
        if (!response.ok || !payload.setting) throw new Error(payload.error ?? "No s’ha pogut desar la configuració.");
        setSetting(payload.setting);
        setMessage(enabled ? "L’OCR automàtic ha quedat activat." : "L’OCR automàtic ha quedat desactivat.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No s’ha pogut desar la configuració.");
      }
    });
  }

  return (
    <section className="surface mt-6 p-5" aria-labelledby="automatic-ocr-title">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <ScanText className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="automatic-ocr-title" className="font-semibold">OCR automàtic</h2>
              <p className="mt-0.5 text-sm font-medium" data-testid="ocr-status">
                {setting.enabled ? "Activat" : "Desactivat"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Quan un PDF no conté text digital, el sistema convertirà les pàgines en imatges i intentarà llegir-les en català i castellà. Només s’utilitza quan l’extracció normal no obté text.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            El canvi s’aplica als lots i processos automàtics que es creïn a partir d’ara. Pot augmentar el temps i el consum de Vercel en documents escanejats. Es processen com a màxim 25 pàgines per document.
          </p>
          {setting.updatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Darrera modificació: {new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(setting.updatedAt))}
            </p>
          )}
        </div>
        <Button type="button" variant={setting.enabled ? "outline" : "default"} disabled={pending} onClick={toggle}>
          {pending ? "Desant…" : setting.enabled ? "Desactivar OCR automàtic" : "Activar OCR automàtic"}
        </Button>
      </div>
      {message && <p role="status" className="mt-4 rounded-lg border bg-background p-3 text-sm">{message}</p>}
    </section>
  );
}

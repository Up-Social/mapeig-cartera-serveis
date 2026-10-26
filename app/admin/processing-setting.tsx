'use client';

import {useState, useTransition} from 'react';
import {Button} from '@/components/ui/button';
import type {ProcessingSetting as Setting} from '@/lib/processing-control';

const reasons: Record<string, string> = {
  operator_pause: 'Aturat des d’Administració.',
  incident_recovery: 'Aturat preventivament durant la recuperació del servei.',
  vercel_storage_recovery: 'Aturat preventivament durant la recuperació del servei.',
  SANDBOX_STOP_UNCONFIRMED: 'No s’ha pogut confirmar el tancament d’un entorn de processament.',
  SANDBOX_UNEXPECTED_SNAPSHOT: 'Vercel ha conservat una còpia inesperada. Cal revisar-la abans de continuar.',
  sandbox_inventory_unsafe: 'Cal revisar les còpies automàtiques o els entorns de processament de Vercel.',
  sandbox_inventory_unavailable: 'No s’ha pogut verificar el consum d’emmagatzematge de Vercel.',
  sandbox_cleanup_failed: 'No s’ha pogut confirmar el tancament d’un entorn de processament.',
  state_unavailable: 'No s’ha pogut consultar la configuració. El processament queda aturat preventivament.',
  setting_missing: 'Falta la configuració de processament. Cal completar la instal·lació.',
};

export function ProcessingSetting({initialSetting}: {initialSetting: Setting}) {
  const [setting, setSetting] = useState(initialSetting);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  function toggle() {
    const enabled = !setting.enabled;
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/settings/processing', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({enabled}),
        });
        const payload = await response.json() as {setting?: Setting; error?: string};
        if (payload.setting) setSetting(payload.setting);
        if (!response.ok || !payload.setting) throw new Error(payload.error ?? 'No s’ha pogut desar la configuració.');
        setMessage(enabled ? 'Processament activat. Els lots antics continuen aturats.' : 'Processament aturat. Les operacions ja iniciades conservaran el seu progrés.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No s’ha pogut desar la configuració.');
      }
    });
  }
  return (
    <section className="surface p-5" aria-labelledby="processing-title" aria-busy={pending}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <h2 id="processing-title" className="font-semibold">Processament de documents i IA</h2>
          <p className="text-sm font-medium" data-testid="processing-status">{setting.enabled ? 'Activat' : 'Aturat preventivament'}</p>
          <p className="text-sm leading-6 text-muted-foreground">Pots continuar consultant documents, revisant resultats i exportant dades quan el processament està aturat. No s’iniciaran nous processos de documents ni peticions d’IA.</p>
          {!setting.enabled && setting.reason && <p role="status" className="rounded-lg border p-3 text-sm">{reasons[setting.reason] ?? 'Hi ha una incidència tècnica pendent de revisar abans de reprendre el processament.'}</p>}
          <p className="text-xs leading-5 text-muted-foreground">L’activació comprova l’emmagatzematge i fa una prova breu del servei. No reprèn automàticament els lots aturats.</p>
          <a className="inline-block text-sm underline underline-offset-4" href="/api/admin/sandbox-inventory">Descarregar inventari de Vercel</a>
          {setting.updatedAt && <p className="text-xs text-muted-foreground">Darrera modificació: {new Intl.DateTimeFormat('ca-ES', {dateStyle:'short',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(setting.updatedAt))}</p>}
        </div>
        <Button type="button" variant={setting.enabled ? 'outline' : 'default'} disabled={pending} onClick={toggle}>
          {pending ? 'Comprovant…' : setting.enabled ? 'Aturar processament' : 'Activar processament'}
        </Button>
      </div>
      {message && <p role="status" className="mt-4 rounded-lg border p-3 text-sm">{message}</p>}
    </section>
  );
}

import type {PauseEntry, PauseReason, PausedTaskSummary} from '@/lib/cloud/paused-task-summary';

const reasons: Record<PauseReason, string> = {
  scope_unverified: 'No s’ha pogut verificar l’abast del treball original.',
  provider_uncertain: 'Hi ha una petició amb resposta incerta que cal conciliar.',
  cost_unsettled: 'Hi ha una reserva de cost pendent de conciliar.',
  no_completed_successor: 'No hi ha una execució posterior completada del mateix treball.',
  result_unverified: 'No s’ha pogut verificar el resultat del treball.',
};
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Data no disponible' : new Intl.DateTimeFormat('ca-ES', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid'}).format(parsed);
}
function Attempts({entries}: {entries: PauseEntry[]}) {
  return <ul className="mt-3 divide-y">
    {entries.map(entry => <li key={entry.taskId} className="space-y-2 py-3 text-sm">
      <p className="font-medium">{entry.runId ? <a href={`/batches/${entry.runId}`} className="underline underline-offset-4">{entry.batchNumber != null ? `Execució ${entry.batchNumber}` : 'Veure l’execució'}</a> : 'Intent sense execució identificada'} · {date(entry.createdAt)}</p>
      <p>{entry.resolution ? `Treball completat posteriorment el ${date(entry.resolution.completedAt)}.` : entry.reason ? reasons[entry.reason] : ''}</p>
      <p className="text-xs text-muted-foreground">Estat original conservat: {entry.originalState}{entry.originalFailure ? ` · ${entry.originalFailure}` : ''}</p>
      <p className="break-all text-xs text-muted-foreground">Intent original: {entry.taskId}{entry.resolution ? ` · Execució completada: ${entry.resolution.taskId}` : ''}</p>
    </li>)}
  </ul>;
}

export function PausedTasks({summary}: {summary: PausedTaskSummary | null}) {
  return <section className="surface space-y-4 p-5" aria-labelledby="paused-tasks-title">
    <div>
      <h2 id="paused-tasks-title" className="font-semibold">Seguiment de les pauses</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Execucions al núvol. Els intents històrics amb el mateix treball completat posteriorment no compten com a pauses per revisar.</p>
    </div>
    {summary ? <>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4"><dt className="text-sm">Pauses per revisar</dt><dd className="mt-1 text-2xl font-semibold" data-testid="paused-needs-review">{summary.needsReview.length}</dd></div>
        <div className="rounded-lg border p-4"><dt className="text-sm">Intents històrics resolts posteriorment</dt><dd className="mt-1 text-2xl font-semibold" data-testid="paused-historical-resolved">{summary.historicalResolved.length}</dd></div>
      </dl>
      {summary.needsReview.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Revisar les pauses ({summary.needsReview.length})</summary><Attempts entries={summary.needsReview} /></details>}
      {summary.historicalResolved.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Consultar els intents històrics ({summary.historicalResolved.length})</summary><Attempts entries={summary.historicalResolved} /></details>}
      {!summary.needsReview.length && <p className="text-sm">No hi ha pauses pendents de revisió tècnica en aquest recompte.</p>}
    </> : <p role="status" className="rounded-lg border p-3 text-sm">No s’ha pogut verificar el recompte. Torna a carregar la pàgina; no s’ha modificat cap tasca.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Aquest resum és de consulta: conserva els estats originals, els checkpoints i tots els costos. No reprèn cap execució. Un treball completat pot continuar pendent de revisió humana o amb evidència insuficient.</p>
  </section>;
}

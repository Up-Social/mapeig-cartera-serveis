type ConcertReprocessProps = {
  recordId: string;
  historical: boolean;
  busy: boolean;
  active: boolean;
  cloudBlocked: boolean;
  recoveryPending: boolean;
  recoveryChecking: boolean;
  recoveryReady: boolean;
  recoveryRetryable: boolean;
  message: string;
  error: string;
  onReprocess: () => void;
  onCheckStatus: () => void;
  onRetryPending: () => void;
};

/** Uses the existing complete record operation; it does not approve results. */
export function ConcertReprocess({recordId,historical,busy,active,cloudBlocked,recoveryPending,recoveryChecking,recoveryReady,recoveryRetryable,message,error,onReprocess,onCheckStatus,onRetryPending}:ConcertReprocessProps){
  const blockedReason=historical
    ? 'Estàs consultant una execució històrica. Obre la fitxa actual per iniciar un nou processament.'
    : !recoveryReady
      ? 'Comprovant si hi ha una petició anterior pendent de confirmar…'
    : recoveryPending
      ? 'Hi ha una petició pendent de confirmar. Comprova’n l’estat abans de tornar a processar; no es repetirà automàticament.'
    : cloudBlocked
      ? 'El processament no està disponible en aquest entorn de consulta.'
      : active
        ? 'Aquest concert té una operació en curs. Consulta el progrés abans d’iniciar-ne una altra.'
        : busy
          ? 'Espera que acabi l’operació actual.'
          : null;
  return <section id="concert-reprocess" className="surface scroll-mt-32 p-4" aria-labelledby="concert-reprocess-heading">
    <h2 id="concert-reprocess-heading" className="text-base font-semibold">Tornar a processar el concert</h2>
    <p className="mt-2 text-sm leading-6">Torna a cercar i descarregar les fonts, extreu el contingut i analitza la resolució i els annexos per proposar la correspondència amb la Cartera. El resultat anterior es conserva a l’historial i la nova proposta requereix revisió humana; aquesta acció no aprova resultats.</p>
    <p className="mt-2 text-sm">Si el contingut d’una font ha canviat, es conservarà la versió anterior i el canvi quedarà pendent de contrast abans de substituir dades.</p>
    <p className="mt-2 text-sm">Pot tenir cost d’IA i OCR. Si una font no es pot recuperar o llegir completament, el cas quedarà pendent amb el motiu.</p>
    <button type="button" className="mt-3 rounded-md border border-current px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={!!blockedReason} aria-describedby={blockedReason?'concert-reprocess-blocked':undefined} onClick={onReprocess}>Tornar a cercar i processar el concert</button>
    {blockedReason&&<p id="concert-reprocess-blocked" role="status" className="mt-2 text-sm">{blockedReason}</p>}
    {historical&&<a href={`/records/${recordId}#concert-reprocess`} className="mt-2 inline-block text-sm underline">Obrir la fitxa actual del concert</a>}
    {!historical&&recoveryPending&&<button type="button" className="mt-3 rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||recoveryChecking} onClick={onCheckStatus}>{recoveryChecking?'Comprovant…':'Comprovar l’estat de la petició'}</button>}
    {!historical&&recoveryPending&&recoveryRetryable&&<div className="mt-3"><p id="concert-retry-explanation" className="text-sm">Si la petició no va arribar, pots reenviar la mateixa petició. Es conserva la referència original: si ja es va registrar, el servidor no iniciarà una segona anàlisi.</p><button type="button" className="mt-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50" aria-describedby="concert-retry-explanation" disabled={busy||active||cloudBlocked||recoveryChecking||!recoveryReady} onClick={onRetryPending}>Reenviar la mateixa petició</button></div>}
    {message&&<p role="status" className="mt-2 text-sm">{message}</p>}
    {error&&<p role="alert" className="mt-2 text-sm">{error}</p>}
  </section>;
}

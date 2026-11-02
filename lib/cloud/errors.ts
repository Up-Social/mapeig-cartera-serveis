import {conveniMissingFieldMessages} from '../convenis/missing-field-messages';
export class CloudYield extends Error {constructor(public wait=1){super("yield");}}
export type FailureKind='budget'|'transient'|'vercel_quota'|'openai_quota'|'credentials'|'document'|'validation'|'provider_unknown'|'provider_reconciliation'|'internal';
export class CloudFailure extends Error {
 constructor(public kind:FailureKind,public retryAfter=5, public diagnostic?:{operation:string;code:string;message?:string;details?:unknown}){super(kind);}
}
export function publicFailure(error:unknown):CloudFailure {
 return error instanceof CloudFailure?error:new CloudFailure('internal');
}
export const failureLabels:Record<FailureKind,string>={
 budget:'Límit preventiu de consum assolit o model sense pressupost validat. Cal revisar el pressupost abans de reprendre.',
 transient:'Incidència temporal. Es tornarà a intentar.',vercel_quota:'Quota de Vercel esgotada.',openai_quota:'Quota de la IA esgotada.',
 credentials:'Cal revisar les credencials.',document:'Document no processable.',validation:'Resposta no vàlida.',
 provider_unknown:'Resultat de la petició desconegut. Cal revisió abans de repetir-la.',provider_reconciliation:'Hi ha respostes o reserves de proveïdor pendents de conciliació. Cal revisar-les abans de continuar.',internal:'Execució interrompuda. Cal revisar el diagnòstic tècnic.'
};

/** Fixed, user-facing diagnostics; never copy arbitrary provider details. */
export function failureMessage(failure:CloudFailure):string {
 if(failure.diagnostic?.operation==='concert_discard_review'&&failure.diagnostic.code==='EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED'){
  const reasons:Record<string,string>={
   receipt_not_received:'No s’ha confirmat la resposta d’una petició anterior de la IA. Cal comprovar-ne el resultat abans de repetir-la.',
   unsupported_receipt_phase:'Hi ha una resposta anterior de la IA que no es pot vincular a una fase reconeguda del procés. Cal revisar-ne la traçabilitat.',
   invalid_receipt_usage:'La resposta de la IA no inclou un consum vàlid. Cal confirmar-lo abans de continuar.',
   usage_missing:'S’ha rebut la resposta de la IA, però falta registrar-ne el consum. Cal completar la conciliació abans de continuar.',
   usage_mismatch:'El consum registrat no coincideix amb el de la resposta de la IA. Cal contrastar tots dos registres abans de continuar.',
   reservation_missing:'S’ha rebut la resposta de la IA, però no s’ha trobat la reserva de pressupost corresponent. Cal revisar-la abans de continuar.',
   settlement_pending:'S’ha rebut la resposta de la IA, però el seu cost encara està pendent de liquidar. Cal conciliar la reserva abans de continuar.',
   unsupported_pricing:'No es pot verificar la tarifa aplicada a una resposta anterior de la IA. Cal revisar-ne el cost abans de continuar.',
   settlement_mismatch:'El cost liquidat no coincideix amb el consum i la tarifa de la petició. Cal revisar la diferència abans de continuar.',
   orphan_reservation:'Hi ha una reserva de pressupost sense una resposta de la IA vinculada. Cal comprovar si la petició es va executar abans de repetir-la.',
   orphan_usage:'Hi ha consum registrat sense una resposta de la IA vinculada. Cal revisar-ne la traçabilitat abans de continuar.',
  };
  const detail=failure.diagnostic.details;
  if(detail&&typeof detail==='object'&&'reason' in detail&&typeof detail.reason==='string'&&Object.hasOwn(reasons,detail.reason))return reasons[detail.reason];
 }
 const messages:Record<string,string>={
  PROVIDER_UNKNOWN_RESOURCE_RELEASE_UNCONFIRMED:'El resultat del proveïdor i l’alliberament del recurs no es poden confirmar. Cal revisar-los abans de reprendre.',
  PROVIDER_RESOURCE_RELEASE_UNCONFIRMED:'No es pot confirmar l’alliberament del recurs de la IA. Cal revisar-ne l’estat i el resultat abans de reprendre.',
  OCR_PAGE_OUTCOME_UNCERTAIN:'El resultat de l’OCR d’una pàgina és desconegut. Cal revisar-lo abans de tornar-lo a executar.',
  OCR_JOURNAL_UNVERIFIED:'No es pot verificar la procedència de la pàgina OCR guardada. Cal revisar-la abans de reutilitzar-la o repetir-la.',
  OCR_PAGE_EXISTS_ELSEWHERE:'Hi ha una pàgina OCR guardada en una altra tasca. Cal revisar-la abans de repetir la lectura.',
  LEGACY_OCR_SOURCE_UNVERIFIED:'Hi ha una lectura OCR anterior amb origen no verificable. Cal revisar-la abans de repetir-la.',
  EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED:'Hi ha respostes o reserves de proveïdor pendents de conciliació. Cal revisar-les abans de continuar.',
  RECEIPT_QUERY_FAILED:'No s’ha pogut comprovar l’estat de les respostes del proveïdor. Cal revisar-lo abans de continuar.',
  CONCERT_REFRESH_REVISION_CHANGED:'La versió documental ha canviat durant el reprocessament. Cal revisar l’estat abans de continuar; no es reutilitza una comprovació anterior.',
  CONCERT_SOURCE_CHANGED:'La font oficial ha canviat respecte de la còpia arxivada. Es conserva la versió anterior; cal revisar la nova font abans de substituir-la.',
  CONCERT_ARCHIVE_UNAVAILABLE:'No s’ha pogut verificar la còpia documental anterior. Cal recuperar-la o revisar-ne la integritat abans de completar el reprocessament.',
  CONCERT_SOURCE_REFRESH_FAILED:'No s’ha completat la nova recuperació o lectura de la font oficial. Es conserva la versió anterior; el reprocessament queda pendent.',
  CONCERT_EXTRACTION_INCOMPLETE:'La nova extracció no cobreix tot el document. Cal revisar les pàgines pendents; no es presenta com a completa.',
  ...conveniMissingFieldMessages,
  CONVENI_MODEL_DISCARD_REVIEW_REQUIRED:'La proposta de descart està pendent de contrast documental. No s’ha descartat ni aprovat automàticament.',
 };
 const primary=(failure.diagnostic?.code&&messages[failure.diagnostic.code])||failureLabels[failure.kind];
 const details=failure.diagnostic?.details;
 if(failure.kind!=='validation'||failure.diagnostic?.operation!=='conveni_analysis'||!Array.isArray(details))return primary;
 const result=[primary];
 for(const item of details) {
  if(!item||typeof item!=='object'||typeof item.code!=='string'||!Object.hasOwn(conveniMissingFieldMessages,item.code))continue;
  const message=conveniMissingFieldMessages[item.code];
  if(!result.includes(message))result.push(message);
 }
 return result.join('\n');
}

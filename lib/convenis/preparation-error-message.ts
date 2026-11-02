import {CopyPreparationUncertain} from './first-copy-preparer';

/** Explain uncertain writes without exposing provider or database errors. */
export function preparationErrorMessage(error:unknown):string {
 if(error instanceof CopyPreparationUncertain){
  if(error.stage==='operation')return 'No s’ha pogut confirmar l’estat de la preparació. Una operació pot haver continuat al servidor. Revisa l’estat i els comprovants abans de continuar.';
  return error.stage==='copy'
   ? 'No s’ha pogut confirmar si s’ha creat la còpia del document; l’operació pot haver continuat al servidor. Revisa l’estat de la preparació i els comprovants abans de continuar.'
   : 'No s’ha pogut confirmar el comprovant de la còpia; l’operació pot haver continuat al servidor. Revisa l’estat de la preparació i els comprovants abans de continuar.';
 }
 const message=typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';
 if(message.includes('PREPARATION_RECONCILIATION_REQUIRED'))return 'Hi ha una preparació anterior pendent. Cal revisar-ne l’estat i els comprovants abans de continuar.';
 if(message.includes('MANIFEST_NEEDS_FULL_REVIEW'))return 'Falta revisar algun document o annex del conveni. No s’ha atribuït cap import.';
 return 'No s’ha pogut completar la preparació. Comprova les fonts i reconcilia l’operació abans de repetir-la.';
}

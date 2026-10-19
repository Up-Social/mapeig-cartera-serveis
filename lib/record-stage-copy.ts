import type {FinancingType} from './financing-types';

const contrast = {
 title:'Contrastar dades',
 processing:'Contrastant amb la font oficial',
 progress:'Contrastant les dades amb la font oficial',
 completed:'Dades oficials contrastades',
 error:'Errors de contrast',
 retry:'Reintentar només el contrast',
 description:'Preparar fonts no utilitza OpenAI. Contrastar dades utilitza IA per estructurar només la font oficial, sense escollir cap servei. El registre només es considera correcte després de la validació humana.',
};
const resolution = {
 title:'Anàlisi de la resolució',
 processing:'Analitzant la resolució',
 progress:'Analitzant les dades de la resolució oficial',
 completed:'Dades de la resolució extretes',
 error:'Error d’anàlisi de la resolució',
 retry:'Reintentar només l’anàlisi de la resolució',
 description:'Preparar fonts descarrega i llegeix els documents. L’anàlisi de la resolució n’extreu les dades; el procés identifica l’acte i desglossa els annexos compatibles. El pas 3 proposa la correspondència amb la Cartera. Cal validació humana.',
};

/** Labels only: the persisted phase remains enrichment for historical compatibility. */
export function recordDataStage(financingType:FinancingType){
 return financingType==='conveni'?{...contrast,title:'Anàlisi del conveni',progress:'Analitzant beneficiaris, imports i serveis del conveni',completed:'Propostes del conveni preparades',description:'Primer s’apliquen les exclusions de l’abast. L’Excel aporta els camps estructurats i el document acredita NIF, població, servei i desglossaments. Cal revisar cada entitat.'}:financingType==='concert'?resolution:contrast;
}

/** Historical progress receipts retain their original text; adapt only known labels. */
export function recordDataStageDetail(financingType:FinancingType,detail:string|null){
 if(financingType!=='concert')return detail;
 if(detail===contrast.progress||detail===contrast.processing)return resolution.progress;
 if(detail===contrast.completed)return resolution.completed;
 return detail;
}

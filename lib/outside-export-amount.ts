import {compareImportedAmount} from './source-comparison';
export const OUTSIDE_AMOUNT_NOTE='En convenis, l’import queda pendent perquè l’import global de la font no acredita l’import atribuïble al servei fora de cartera. Una cel·la buida no significa que no existeixi finançament.';

type OutsideAmountSource={source_dataset?:string|null;financing_type?:string|null;amount?:number|null;contract_verified_award?:number|null;
 record_enrichments?:{amount?:number|null}|Array<{amount?:number|null}>|null};

/** A source-level amount is not proof of the part attributable to an outside unit. */
export function conveniOutsideAmountPending(source:OutsideAmountSource|null|undefined):boolean{
 return source?.source_dataset==='convenis'||source?.financing_type==='conveni';
}

export function outsideExportExplanation(source:OutsideAmountSource|null|undefined,explanation:string|null|undefined):string|null{
 if(!conveniOutsideAmountPending(source))return explanation??null;
 return [explanation,OUTSIDE_AMOUNT_NOTE].filter(Boolean).join('\n');
}

/** The computed field is evaluated by PostgreSQL before JSON number parsing. */
export function outsideExportAmount(source:OutsideAmountSource|null|undefined):number|null{
 if(conveniOutsideAmountPending(source))return null;
 const enrichment=Array.isArray(source?.record_enrichments)?source.record_enrichments[0]:source?.record_enrichments;
 const result=compareImportedAmount(source?.source_dataset??'',source?.amount??null,enrichment?.amount??null,source?.contract_verified_award,source?.financing_type);
 return typeof result.effective==='number'&&Number.isFinite(result.effective)?result.effective:null;
}

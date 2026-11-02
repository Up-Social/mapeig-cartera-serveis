/** The template aggregates only these four literal values. The category is
 * derived from the source record's explicit financing_type, not model text. */
const MECHANISMS = {concert:'Concierto',subvencio:'Subvención',conveni:'Convenio',contractacio:'Contratación'} as const;
type FinancingType = keyof typeof MECHANISMS;
type FormulaPair = {sum: string | null; count: string | null};
export type TemplateRow = {code:string; rowNumber:number; total:string|null; formulas: Partial<Record<FinancingType,FormulaPair>>};
export type TemplateCoverage = Map<string,Set<FinancingType>>;

const columns:Record<FinancingType,[number,number]>={concert:[5,6],subvencio:[7,8],conveni:[9,10],contractacio:[11,12]};
export function templateColumns(type:FinancingType):[number,number]{return columns[type];}
export const MASTER_FINANCING_TYPES = Object.keys(MECHANISMS) as FinancingType[];
function normalizedFormula(value:string|null):string{return (value??'').replace(/^=/,'').replace(/\s+/g,'').toLocaleUpperCase('es');}
function supported(pair:FormulaPair|undefined,row:number,label:string):boolean {
 if(!pair)return false;
 const sum=`SUMIFS(Detalle_Provisiones!$H:$H,Detalle_Provisiones!$L:$L,$A${row},Detalle_Provisiones!$F:$F,"${label}")`;
 const count=`COUNTIFS(Detalle_Provisiones!$L:$L,$A${row},Detalle_Provisiones!$F:$F,"${label}")`;
 return normalizedFormula(pair.sum)===normalizedFormula(sum)&&normalizedFormula(pair.count)===normalizedFormula(count);
}
/** Duplicated master keys are ambiguous and cannot be aggregated. */
export function buildMasterCoverage(rows:TemplateRow[]):TemplateCoverage {
 const found=new Map<string,Set<FinancingType>>();const duplicate=new Set<string>();
 for(const row of rows){
  const code=row.code.trim();if(!code)continue;
  if(found.has(code)){duplicate.add(code);continue;}
  const validTotal=normalizedFormula(row.total)===normalizedFormula(`E${row.rowNumber}+G${row.rowNumber}+I${row.rowNumber}+K${row.rowNumber}`);
  found.set(code,new Set(validTotal ? MASTER_FINANCING_TYPES.filter(type=>supported(row.formulas[type],row.rowNumber,MECHANISMS[type])) : []));
 }
 for(const code of duplicate)found.delete(code);
 return found;
}

type Relation = {financing_type?:unknown} | Array<{financing_type?:unknown}> | null;
export type MasterExportInput = {
 historical_master_code?:unknown; service_code?:unknown; catalog_version_id?:unknown; amount?:unknown;
 source_records?:Relation;
};
export type MasterExportDecision = {masterCode:string|null;storedCode:string|null;officialCode:string|null;catalogVersion:string|null;mechanism:string|null;amount:number|null;warning:string|null};
export function decideMasterExport(row:MasterExportInput,coverage:TemplateCoverage):MasterExportDecision {
 const source=Array.isArray(row.source_records)?row.source_records[0]:row.source_records;
 const type=source?.financing_type;
 const verifiedType=typeof type==='string'&&Object.prototype.hasOwnProperty.call(MECHANISMS,type) ? type as FinancingType : null;
 const mechanism=verifiedType?MECHANISMS[verifiedType]:null;
 const storedCode=typeof row.service_code==='string'&&row.service_code.trim()?row.service_code:null;
 const catalogVersion=typeof row.catalog_version_id==='string'&&row.catalog_version_id.trim()?row.catalog_version_id:null;
 const officialCode=catalogVersion?storedCode:null;
 const historical=typeof row.historical_master_code==='string'&&row.historical_master_code.trim()?row.historical_master_code.trim():null;
 const rawAmount=row.amount;
 const amount=(typeof rawAmount==='number'||(typeof rawAmount==='string'&&rawAmount.trim()!==''))&&Number.isFinite(Number(rawAmount))?Number(rawAmount):null;
 let warning:string|null=null;
 if(!historical)warning='Sense equivalència Master documentada';
 else if(!coverage.has(historical))warning='Codi Master absent o duplicat a la plantilla';
 else if(!verifiedType)warning='Tipologia de finançament desconeguda';
 else if(!coverage.get(historical)!.has(verifiedType))warning='Fórmules de la plantilla no verificades per a aquesta tipologia';
 else if(amount===null)warning='Import no informat o no vàlid';
 return {masterCode:warning?null:historical,storedCode,officialCode,catalogVersion,mechanism,amount,warning};
}

/** Fail closed when a legacy or partially migrated PostgREST schema cannot
 * prove the linkage or the type. Do not infer them from free text. */
export function masterExportReadError(error:unknown):{status:number;message:string} {
 const problem=error && typeof error==='object' ? error as {code?:unknown;message?:unknown;details?:unknown} : {};
 const code=typeof problem.code==='string'?problem.code:'';
 if(['42703','42P01','PGRST200','PGRST201','PGRST204','PGRST205'].includes(code)){
  const details=[problem.message,problem.details].filter((v):v is string=>typeof v==='string').join(' ');
  let missing='una columna o relació necessària';
  if(details.includes('historical_master_code'))missing='el vincle històric documentat amb el Master';
  else if(details.includes('catalog_version_id'))missing='la versió del catàleg oficial';
  else if(details.includes('financing_type'))missing='la tipologia de finançament del registre d’origen';
  else if(details.includes('source_records'))missing='la relació amb el registre d’origen';
  else if(details.includes('conveni_reviewed_provisions'))missing='la vista de provisions vigents';
  return {status:409,message:`No es pot generar el Master: l’esquema actual no permet verificar ${missing}. Cal revisar les migracions i la memòria d’esquema abans d’exportar.`};
 }
 return {status:500,message:'No s’han pogut llegir les provisions vigents. Reviseu la connexió i torneu-ho a provar.'};
}

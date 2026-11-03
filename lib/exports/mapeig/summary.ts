import {classifyOrgan,codeEquals,codeMatches,ORGAN_CLASSES,type OrganClass} from './organ';
import {MAPEIG_MECHANISMS,MAPEIG_PROVINCES,type DetallRegistresRow,type MapeigMechanism,type MapeigProvince} from './types';

/** The same numbers the Taula (resum) formulas produce, computed in integer
 * cents: cached results for the workbook and the on-screen preview. */
export type MechanismTotals=Record<MapeigMechanism,{amountCents:number;count:number}>;
export type OrganShares=Record<OrganClass,number|null>;
export type SummaryCode={code:string;row:number};
export type CodeAggregate={
 code:string;row:number;byMechanism:MechanismTotals;totalCents:number;dominant:'Sense dades'|MapeigMechanism;
 share:OrganShares;distinctNifs:number;byProvince:Record<MapeigProvince,number>;ownLevelCents:number;level:number|'-';hasChildren:boolean;
};
export type MapeigSummary={
 rowCount:number;
 byCode:CodeAggregate[];
 total:{byMechanism:MechanismTotals;totalCents:number;dominant:'Sense dades'|MapeigMechanism;share:OrganShares;byProvince:Record<MapeigProvince,number>;distinctNifs:number;ownLevelSumCents:number};
 unmatchedCents:number;          // M163 = M162 − Z162
 unclassifiedOrganCents:number;  // M164: amounts whose organ matches no keyword group
 withoutProvinceCents:number;
 counts:{withoutNif:number;withoutCode:number;withoutAmount:number;withoutDate:number;withoutProvince:number;withoutOrgan:number;unlistedCode:number};
};

export const toCents=(amount:number|null):number=>amount===null?0:Math.round(amount*100);
const emptyMechanisms=():MechanismTotals=>Object.fromEntries(MAPEIG_MECHANISMS.map(m=>[m,{amountCents:0,count:0}])) as MechanismTotals;
const emptyProvinces=():Record<MapeigProvince,number>=>Object.fromEntries(MAPEIG_PROVINCES.map(p=>[p,0])) as Record<MapeigProvince,number>;
/** Same cascade as column N of the template. */
export function dominantMechanism(totals:MechanismTotals):'Sense dades'|MapeigMechanism{
 const e=totals.Concert.amountCents,g=totals['Subvenció'].amountCents,i=totals.Conveni.amountCents,k=totals['Contractació'].amountCents;
 if(e+g+i+k===0)return 'Sense dades';
 if(e>=g&&e>=i&&e>=k)return 'Concert';
 if(g>=i&&g>=k)return 'Subvenció';
 return i>=k?'Conveni':'Contractació';
}
function shares(rows:readonly DetallRegistresRow[],totalCents:number):OrganShares{
 const sums:Record<OrganClass,number>={dsi:0,altresGeneralitat:0,noGeneralitat:0};
 for(const row of rows){const organ=classifyOrgan(row.contractingBody);if(organ)sums[organ]+=toCents(row.amount);}
 return Object.fromEntries(ORGAN_CLASSES.map(c=>[c,totalCents===0?null:sums[c]/totalCents])) as OrganShares;
}
function aggregate(rows:readonly DetallRegistresRow[]){
 const byMechanism=emptyMechanisms(),byProvince=emptyProvinces();
 for(const row of rows){
  byMechanism[row.mechanism].amountCents+=toCents(row.amount);byMechanism[row.mechanism].count+=1;
  if(row.province)byProvince[row.province]+=toCents(row.amount);
 }
 const totalCents=MAPEIG_MECHANISMS.reduce((sum,m)=>sum+byMechanism[m].amountCents,0);
 return {byMechanism,byProvince,totalCents,dominant:dominantMechanism(byMechanism),share:shares(rows,totalCents),distinctNifs:new Set(rows.map(r=>r.providerNif?.trim()).filter(Boolean)).size};
}
export const codeLevel=(code:string):number|'-'=>code.startsWith('1')?code.split('.').length:'-';

export function summarizeMapeig(rows:readonly DetallRegistresRow[],codes:readonly SummaryCode[]):MapeigSummary{
 const known=new Set(codes.map(c=>c.code.toUpperCase()));
 const byCode:CodeAggregate[]=codes.map(({code,row})=>{
  const matching=rows.filter(r=>codeMatches(r.carteraCode,code));
  return {code,row,...aggregate(matching),ownLevelCents:rows.filter(r=>codeEquals(r.carteraCode,code)).reduce((sum,r)=>sum+toCents(r.amount),0),
   level:codeLevel(code),hasChildren:codes.some(other=>other.code.toUpperCase().startsWith(`${code.toUpperCase()}.`))};
 });
 const total=aggregate(rows),ownLevelSumCents=byCode.reduce((sum,c)=>sum+c.ownLevelCents,0);
 return {
  rowCount:rows.length,byCode,total:{...total,ownLevelSumCents},
  unmatchedCents:total.totalCents-ownLevelSumCents,
  unclassifiedOrganCents:rows.filter(r=>!classifyOrgan(r.contractingBody)).reduce((sum,r)=>sum+toCents(r.amount),0),
  withoutProvinceCents:rows.filter(r=>!r.province).reduce((sum,r)=>sum+toCents(r.amount),0),
  counts:{
   withoutNif:rows.filter(r=>!r.providerNif?.trim()).length,
   withoutCode:rows.filter(r=>!r.carteraCode).length,
   withoutAmount:rows.filter(r=>r.amount===null).length,
   withoutDate:rows.filter(r=>!r.awardDate).length,
   withoutProvince:rows.filter(r=>!r.province).length,
   withoutOrgan:rows.filter(r=>!classifyOrgan(r.contractingBody)).length,
   unlistedCode:rows.filter(r=>!!r.carteraCode&&!known.has(r.carteraCode.toUpperCase())).length,
  },
 };
}

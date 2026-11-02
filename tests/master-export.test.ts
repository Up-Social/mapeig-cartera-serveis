import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMasterCoverage,decideMasterExport,templateColumns,MASTER_FINANCING_TYPES,masterExportReadError,type TemplateRow} from '../lib/master-export';
const labels={concert:'Concierto',subvencio:'Subvención',conveni:'Convenio',contractacio:'Contratación'} as const;
function template(code='1.1.1',rowNumber=4):TemplateRow {
 return {code,rowNumber,total:`E${rowNumber}+G${rowNumber}+I${rowNumber}+K${rowNumber}`,formulas:Object.fromEntries(MASTER_FINANCING_TYPES.map(type=>[type,{
  sum:`SUMIFS(Detalle_Provisiones!$H:$H,Detalle_Provisiones!$L:$L,$A${rowNumber},Detalle_Provisiones!$F:$F,"${labels[type]}")`,
  count:`COUNTIFS(Detalle_Provisiones!$L:$L,$A${rowNumber},Detalle_Provisiones!$F:$F,"${labels[type]}")`,
 }]))};
}
const coverage=buildMasterCoverage([template()]);
test('all four accredited financing types use labels proven by the template',()=>{
 for(const type of MASTER_FINANCING_TYPES){
  const result=decideMasterExport({historical_master_code:'1.1.1',service_code:'official-X',catalog_version_id:'v2',source_records:{financing_type:type},amount:100},coverage);
  assert.equal(result.mechanism,labels[type]);assert.equal(result.masterCode,'1.1.1');assert.equal(result.officialCode,'official-X');assert.equal(result.catalogVersion,'v2');assert.equal(result.warning,null);
  assert.equal(templateColumns(type).length,2);
 }
});
test('official code equality is never used to fabricate a master mapping',()=>{
 const missing=decideMasterExport({historical_master_code:null,service_code:'1.1.1',catalog_version_id:'v2',source_records:{financing_type:'conveni'},amount:100},coverage);
 assert.equal(missing.masterCode,null);assert.equal(missing.officialCode,'1.1.1');assert.match(missing.warning!,/Sense equivalència/);
 const absent=decideMasterExport({historical_master_code:'not-in-template',source_records:{financing_type:'conveni'},amount:100},coverage);
 assert.equal(absent.masterCode,null);assert.match(absent.warning!,/absent o duplicat/);
});
test('zero remains a documented zero, missing and malformed amounts are outside the summary',()=>{
 const input={historical_master_code:'1.1.1',source_records:{financing_type:'concert'}};
 assert.equal(decideMasterExport({...input,amount:0},coverage).masterCode,'1.1.1');
 assert.equal(decideMasterExport({...input,amount:0},coverage).amount,0);
 for(const amount of [null,undefined,'',Number.NaN,Infinity]){
  const result=decideMasterExport({...input,amount},coverage);assert.equal(result.masterCode,null);assert.equal(result.amount,null);assert.match(result.warning!,/Import/);
 }
});
test('unknown financing and missing or changed formulas never get into a total',()=>{
 for(const financing_type of [null,'other','Concert social / gestió delegada']){
  const result=decideMasterExport({historical_master_code:'1.1.1',amount:1,source_records:{financing_type}},coverage);
  assert.equal(result.masterCode,null);assert.equal(result.mechanism,null);assert.match(result.warning!,/desconeguda/);
 }
 const altered=template();altered.formulas.conveni!.sum='SUM(A1:A2)';
 const alteredCoverage=buildMasterCoverage([altered]);
 assert.equal(decideMasterExport({historical_master_code:'1.1.1',amount:1,source_records:[{financing_type:'conveni'}]},alteredCoverage).masterCode,null);
 assert.equal(decideMasterExport({historical_master_code:'1.1.1',amount:1,source_records:{financing_type:'concert'}},alteredCoverage).masterCode,'1.1.1');
 const invalidTotal=template();invalidTotal.total='SUM(A1:A2)';assert.equal(buildMasterCoverage([invalidTotal]).get('1.1.1')?.size,0);
 assert.equal(buildMasterCoverage([template(),template('1.1.1',5)]).has('1.1.1'),false);
});


test('a legacy code without an official version is retained without mislabelling it as official',()=>{
 const result=decideMasterExport({historical_master_code:'1.1.1',service_code:'1.1.1',catalog_version_id:null,source_records:{financing_type:'conveni'},amount:12},coverage);
 assert.equal(result.storedCode,'1.1.1');assert.equal(result.officialCode,null);assert.equal(result.masterCode,'1.1.1');
});


test('legacy and incomplete schemas produce an actionable error, without inventing a mapping or a type',()=>{
 const missingMaster=masterExportReadError({code:'42703',message:'column historical_master_code does not exist'});
 assert.equal(missingMaster.status,409);assert.match(missingMaster.message,/vincle històric/);
 const missingVersion=masterExportReadError({code:'PGRST204',message:'catalog_version_id not found'});
 assert.equal(missingVersion.status,409);assert.match(missingVersion.message,/versió del catàleg/);
 const missingType=masterExportReadError({code:'42703',message:'column source_records.financing_type does not exist'});
 assert.equal(missingType.status,409);assert.match(missingType.message,/tipologia de finançament/);
 const missingRelation=masterExportReadError({code:'PGRST200',message:'relationship source_records missing'});
 assert.equal(missingRelation.status,409);assert.match(missingRelation.message,/relació amb el registre/);
 const denied=masterExportReadError({code:'42501',message:'private connection data'});
 assert.equal(denied.status,500);assert.doesNotMatch(denied.message,/private connection data/);
});

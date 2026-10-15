import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProgramAnnex} from '../lib/concerts/program-annex';
import {recoverConcertDisplayNames} from '../lib/concerts/presentation';
import {concertUnitName,concertLineHref,concertPredecessorIds} from '../lib/concerts/display-name';

function splitHeaderTable(){
 const line=(cells:Array<[number,string]>)=>{let value='';for(const [position,text] of cells)value=value.padEnd(position)+text;return value;};
 const header=line([[27,'NIF entitat'],[43,'Nom entitat'],[74,'Disposició'],[88,'Posició'],[125,'Import assignat'],[149,'Partida pressupostària'],[185,'FUE'],[197,'Codi S'],[212,'Nom servei'],[241,'Municipi'],[262,'Tipologia de servei'],[303,'Places'],[313,'Cost anual']]);
 const second=line([[63,'GECAT'],[98,'finalista'],[110,'inici'],[120,'fi'],[174,'jurídic'],[345,'IVA']]);
 return ['## Pàgina 8',header,'','','GENERALITAT DE CATALUNYA',second,
 line([[41,'Fundació Privada'],[62,'BE-2024-'],[205,'Centre de dia'],[260,'Servei de centre de dia per a gent gran']]),
 line([[27,'G12345678'],[41,'del Nord'],[62,'N636'],[74,'2600000001'],[94,'1'],[125,'100,01 €'],[197,'S01234'],[205,'del Nord'],[239,'Girona'],[303,'4'],[313,'100,01 €'],[345,'100,01 €']])].join('\n');
}
test('split centred headers preserve entity and municipality without absorbing GECAT',()=>{
 const rows=extractProgramAnnex(splitHeaderTable());assert.equal(rows.length,1);
 assert.equal(rows[0].observedProviderName,'Fundació Privada del Nord');assert.equal(rows[0].municipality,'Girona');assert.equal(rows[0].amountCents,10001);
 assert.equal(rows[0].observedServiceName,'Servei de centre de dia per a gent gran');
});
const unit={id:'u',document_id:'doc',page:8,provider_nif:'G12345678',reses_code:'S01234',provider_name:null,observed_provider_name:'ndació Privada BE-2024- l Nord N636',status:'draft',pipeline_job_id:null,source_fingerprint:'immutable',amount:100.01};
test('display repair uses the same document identity without changing source fields or money',()=>{
 const snapshot=JSON.stringify(unit),[recovered]=recoverConcertDisplayNames([unit],[{id:'doc',extracted_text:splitHeaderTable()}]);
 assert.equal(concertUnitName(recovered),'Fundació Privada del Nord');assert.equal(recovered.observed_provider_name,unit.observed_provider_name);assert.equal(recovered.source_fingerprint,'immutable');assert.equal(recovered.amount,100.01);assert.equal(JSON.stringify(unit),snapshot);
 assert.equal(concertLineHref('record','u'),'/records/record#concert-line-u');
});
test('display recovery never infers names from another document, ambiguous rows or a reviewed identity',()=>{
 for(const change of [{document_id:'other'},{provider_nif:'G87654321'},{reses_code:'S99999'},{page:9},{status:'approved'},{provider_name:'Nom revisat'},{pipeline_job_id:'human-job'}]){
  const u={...unit,...change};assert.deepEqual(recoverConcertDisplayNames([u],[{id:'doc',extracted_text:splitHeaderTable()}]),[u]);
 }
 const text=splitHeaderTable()+'\n'+splitHeaderTable();assert.deepEqual(recoverConcertDisplayNames([unit],[{id:'doc',extracted_text:text}]),[unit]);
});

test('rectification choices contain only predecessor chains, exclude rejected/unrelated rows and stop cycles',()=>{
 const link=(later_unit_id:string,earlier_unit_id:string,status='candidate')=>({later_unit_id,earlier_unit_id,status});
 const ids=concertPredecessorIds('change',[link('change','previous'),link('previous','original','confirmed'),link('original','change'),link('change','rejected','rejected'),link('change','pre2024','out_of_horizon'),link('unrelated','other')]);
 assert.deepEqual([...ids],['previous','original']);
});

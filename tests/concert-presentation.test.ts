import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProgramAnnex} from '../lib/concerts/program-annex';
import {recoverConcertDisplayNames,recoverPrintedServiceCandidates} from '../lib/concerts/presentation';
import {extractConcertChangeRows} from '../lib/concerts/change-extraction';
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

test('printed service candidate requires the exact page, economic anchor and current document identity',()=>{
 const columns=(cells:Array<[number,string]>)=>cells.reduce((line,[start,value])=>line.padEnd(start,' ')+value,'');
 const header=columns([[27,'gestor'],[61,'NIF entitat'],[132,'Codi S'],[142,'Nom servei'],[155,'pressupostària']]);
 const row=columns([[50,'Entitat'],[61,'G12345678'],[77,'1.2.6.2.3.2.4'],[94,'suport extens'],[132,'S01234'],[142,'Carme'],[155,'D/0000'],[177,'2025'],[220,'1 1.640,16 €']]);
 const text=['## Pàgina 4','Annex','cost places',header,columns([[142,'Residència']]),columns([[142,'Mare']]),row,'Total general'].join('\n');
 const found=extractConcertChangeRows(text)[0];assert.equal(found.centreObservation?.centre,'Residència Mare Carme');
 const sha='a'.repeat(64);
 const line={id:'u',document_id:'doc',page:found.page,provider_nif:found.nif,reses_code:found.resesCode,observed_service_code:found.observedServiceCode,amount:1_640.16,quantity_delta:1,evidence_quote:found.quote,storage_sha256:sha,act_type:'modification',centre:null};
 const doc={id:'doc',extracted_text:text,storage_sha256:sha,extraction_method:'pdf-text',extraction_coverage:{complete:true},mime_type:'application/pdf',extraction_partial:false,quality_flags:[]};
 const original=JSON.stringify(line);assert.deepEqual(recoverPrintedServiceCandidates([line],[doc])[0].printed_service_candidate,{name:'Residència Mare Carme',page:4});assert.equal(JSON.stringify(line),original);
 for(const changed of [{page:5},{provider_nif:'G87654321'},{reses_code:'S54321'},{observed_service_code:'1.2.3'},{amount:1640.17},{quantity_delta:2},{evidence_quote:'Una altra fila'},{storage_sha256:'b'.repeat(64)},{act_type:'award'},{centre:'Centre revisat'}])assert.equal(recoverPrintedServiceCandidates([{...line,...changed}],[doc])[0].printed_service_candidate,undefined);
 for(const changed of [{extraction_partial:true},{quality_flags:['corrupt_text']},{extraction_method:null},{storage_sha256:null}])assert.equal(recoverPrintedServiceCandidates([line],[{...doc,...changed}])[0].printed_service_candidate,undefined);
 assert.equal(recoverPrintedServiceCandidates([line],[{...doc,extracted_text:text+'\n'+text}])[0].printed_service_candidate,undefined);
 assert.ok(recoverPrintedServiceCandidates([line,{...line,id:'other',centre:'Centre revisat'}],[doc]).every(item=>item.printed_service_candidate===undefined));
});

test('rectification choices contain only predecessor chains, exclude rejected/unrelated rows and stop cycles',()=>{
 const link=(later_unit_id:string,earlier_unit_id:string,status='candidate')=>({later_unit_id,earlier_unit_id,status});
 const ids=concertPredecessorIds('change',[link('change','previous'),link('previous','original','confirmed'),link('original','change'),link('change','rejected','rejected'),link('change','pre2024','out_of_horizon'),link('unrelated','other')]);
 assert.deepEqual([...ids],['previous','original']);
});

test('a merged entity name continues across pages only when there is no new NIF',()=>{
 const first=splitHeaderTable(),lines=first.split('\n');
 const continuedRow=' '.repeat(197)+'S01235'+' '.repeat(110)+'100,01 €   100,01 €';
 const page=['## Pàgina 9',lines[1],lines[5],' '.repeat(41)+'per a persones',continuedRow].join('\n');
 const rows=extractProgramAnnex(first+'\n'+page);
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.observedProviderName==='Fundació Privada del Nord per a persones'));
 const other=first.replace('## Pàgina 8','## Pàgina 9').replace('G12345678','G87654321').replace('Fundació Privada','Associació Nova');
 const separate=extractProgramAnnex(first+'\n'+other);assert.equal(separate[0].observedProviderName,'Fundació Privada del Nord');assert.equal(separate[1].observedProviderName,'Associació Nova del Nord');
});

test('service code presentation separates printed, corrected, prepared and stale values', async()=>{
 const {concertServiceCodeDisplay}=await import('../lib/concerts/service-code-display');
 const printed='1.2.6.2.4.1', specific='1.2.6.2.4.1.1';
 const unit={observed_service_code:printed,service_code:specific};
 assert.deepEqual(concertServiceCodeDisplay({...unit,service_code_correction:{value:specific,valid:true}}),{code:specific,observed:printed,correction:specific,stale:false,prepared:specific});
 assert.deepEqual(concertServiceCodeDisplay({...unit,service_code_correction:{value:specific,valid:false}}),{code:printed,observed:printed,correction:specific,stale:true,prepared:specific});
 assert.equal(concertServiceCodeDisplay({...unit,service_code_correction:null}).code,specific);
 assert.equal(concertServiceCodeDisplay({observed_service_code:null,service_code:specific,service_code_correction:{value:specific,valid:false}}).code,null);
 assert.equal(concertServiceCodeDisplay({...unit,service_code:'1.2.3',service_code_correction:{value:specific,valid:true}}).code,specific);
});

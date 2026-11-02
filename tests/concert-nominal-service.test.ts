import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nominalServiceEvidence} from '../lib/concerts/nominal-service-evidence';
import {proposeNominalConcertService} from '../lib/concerts/nominal-service-proposal';

const name="DE RESIDÈNCIA O PISOS PER A JOVES VINCULATS A PROGRAMES D'INSERCIÓ LABORAL (PIL)";
const quote=`RESOLC: Assignar ${name} en règim de concert social.`;
const text=`## Pàgina 1\nIntroducció\n## Pàgina 2\n${quote}\n`;
const unit={document_id:'doc',storage_sha256:'a'.repeat(64),storage_path:'case/source.pdf',page:2,evidence_quote:quote,observed_service_name:name,observed_service_code:null,service_code:null,act_type:'award',extraction_origin:'official-resolc-v1'};
const doc={id:'doc',storage_sha256:'a'.repeat(64),extracted_text:text,extracted_text_hash:createHash('sha256').update(text).digest('hex'),extraction_method:'pdf-text',extraction_coverage:{complete:true},mime_type:'application/pdf',extraction_partial:false,quality_flags:[]};
const catalog=[{code:'1.2.1.7',name:"Servei de residència o pisos per a joves vinculats a programes d'inserció laboral"}];
test('proposa únicament el nom exactament coincident i amb font vigent',()=>{
 const evidence=nominalServiceEvidence(unit,[doc]);assert.deepEqual(evidence,{name,page:2,documentId:'doc'});
 assert.deepEqual(proposeNominalConcertService(evidence,catalog),{...catalog[0],page:2,documentId:'doc'});
});
test('no proposa davant font alterada, pàgina errònia o extracció incompleta',()=>{
 assert.equal(nominalServiceEvidence(unit,[{...doc,extracted_text:text+'alteració'}]),null);
 assert.equal(nominalServiceEvidence({...unit,page:1},[doc]),null);
 assert.equal(nominalServiceEvidence(unit,[{...doc,extraction_partial:true}]),null);
 assert.equal(nominalServiceEvidence({...unit,observed_service_code:'1.2.1.7'},[doc]),null);
 assert.equal(nominalServiceEvidence({...unit,storage_path:null},[doc]),null);
 assert.equal(nominalServiceEvidence(unit,[{...doc,extraction_coverage:null}]),null);
});
test('rebutja catàlegs amb coincidències ambigües, agrupadors o nom parcial',()=>{
 const evidence=nominalServiceEvidence(unit,[doc]);
 assert.equal(proposeNominalConcertService(evidence,[...catalog,{code:'1.9',name:catalog[0].name}]),null);
 assert.equal(proposeNominalConcertService(evidence,[...catalog,{code:'1.2.1.7.1',name:'Subservei'}]),null);
 assert.equal(proposeNominalConcertService({...evidence!,name:'Residència per a joves'},catalog),null);
});

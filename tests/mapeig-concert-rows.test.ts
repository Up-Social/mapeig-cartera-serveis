import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {concertLineAmount,concertLineProvince,concertRecordAwardDate,concertRowsFromData,type ConcertDocumentRow,type ConcertMapeigData,type ConcertReviewRow,type ConcertUnitRow} from '../lib/exports/mapeig/providers/concert-rows';

const unit=(partial:Partial<ConcertUnitRow>):ConcertUnitRow=>({
 id:'u1',source_record_id:'r1',unit_key:'official-annex:abc:1:1',provider_name:'Fundació A',provider_nif:'G11111111',observed_provider_name:null,observed_service_name:'Centre obert',
 service_code:'1.1.6.1',catalog_version_id:'v1',observed_service_code:'1.1.6.1',reses_code:'S00001',amount:'1000.50',act_type:'award',status:'approved',
 effective_start:'2025-01-01',effective_end:'2025-12-31',period:null,quantity:10,quantity_delta:null,territory:'Vic',municipality:null,centre:'Centre A',
 document_id:'d1',page:3,pipeline_job_id:'j1',horizon_state:'in_scope',review_note:null,...partial,
});
const review=(partial:Partial<ConcertReviewRow>):ConcertReviewRow=>({unit_id:'u1',version:1,status:'approved',source_fingerprint:'f',expected_job_id:'j1',operation:'delta',amount_cents:-5000,amount_kind:'exact',period_start:null,period_end:null,effective_at:'2025-06-01',funder:'Departament de Drets Socials',...partial});
const signedText='## Pàgina 1\nResolució\n## Pàgina 2\nDoc. original signat per:\n  Conseller\n  10/03/2025\n';
const document=(partial:Partial<ConcertDocumentRow>):ConcertDocumentRow=>{
 const text=partial.extracted_text===undefined?signedText:partial.extracted_text;
 return {id:'d1',source_record_id:'r1',url:'https://tauler.example/doc/1.pdf',document_type:'resolution',source_fields:[],status:'fetched',mime_type:'application/pdf',storage_path:'cases/r1/d1.pdf',
  storage_sha256:'a'.repeat(64),active_extraction_id:'11111111-1111-1111-1111-111111111111',extracted_text:text,extracted_text_hash:text?createHash('sha256').update(text).digest('hex'):null,
  extraction_method:'pdf-text-markdown-v2',extraction_partial:false,extraction_coverage:{complete:true},quality_flags:[],...partial};
};
const data=(partial:Partial<ConcertMapeigData>):ConcertMapeigData=>({
 units:[unit({})],records:[{id:'r1',source_record_id:'etauler:1:100',title:'Resolució de provisió',record_url:'https://tauler.example/edicte/100'}],reviews:[],geography:[],supplemental:[],
 corrections:[],populations:[],latestJobs:[{id:'j1',source_record_id:'r1',status:'approved'}],enrichments:[{source_record_id:'r1',award_date:'2025-03-01',contracting_body:'La consellera de Drets Socials',target_population:'Infants en risc',scope_facts:null}],
 provisions:[],documents:[document({})],signatures:[],gates:{supplementalGeography:false,signatureDates:false,printedDates:true,populationEvents:true},...partial,
});
const options={origin:'https://app.example',catalogCodes:new Map([['1.1.6.1','Servei de centre obert'],['1.2.1.3','Servei de centre d’acolliment']])};

test('an award line maps every template column from the line and its record',()=>{
 const result=concertRowsFromData(data({}),options);
 assert.equal(result.rows.length,1);
 const row=result.rows[0];
 assert.equal(row.sourceUrl,'https://tauler.example/edicte/100');assert.equal(row.sourceId,'etauler:1:100');
 assert.equal(row.providerName,'Fundació A');assert.equal(row.providerNif,'G11111111');assert.equal(row.mechanism,'Concert');assert.equal(row.source,'e-Tauler');
 assert.equal(row.awardDate,'2025-03-10','the printed signature date prevails over the extracted one');
 assert.equal(row.extras.otherDate,'2025-03-01');
 assert.equal(row.amount,1000.5);assert.equal(row.contractingBody,'La consellera de Drets Socials');
 assert.equal(row.targetPopulation,'Infants en risc');assert.ok(row.observations.includes('Població del registre, no acreditada per línia'));
 assert.equal(row.province,'Barcelona');assert.equal(row.extras.county,'Osona');assert.equal(row.extras.municipality,'Vic');
 assert.equal(row.carteraCode,'1.1.6.1');assert.equal(row.extras.codeOrigin,'Codi revisat');assert.equal(row.extras.serviceName,'Servei de centre obert');
 assert.equal(row.extras.lineState,'Aprovada');assert.equal(row.extras.actType,'Provisió');assert.equal(row.extras.period,'2025-01-01/2025-12-31');
 assert.equal(row.extras.appLink,'https://app.example/records/r1#concert-line-u1');
});

test('the amount: an approved economic review prevails, otherwise the amount documented on the line',()=>{
 assert.deepEqual(concertLineAmount(unit({}),undefined),{amount:1000.5,origin:'Import de l’annex de la resolució',note:null});
 assert.equal(concertLineAmount(unit({amount:null}),undefined).note,'Import no acreditat');
 assert.deepEqual(concertLineAmount(unit({act_type:'renewal'}),undefined),{amount:1000.5,origin:'Import documentat a la línia de pròrroga',note:'Import documentat; revisió econòmica pendent'});
 assert.deepEqual(concertLineAmount(unit({act_type:'renewal'}),review({status:'draft'})),{amount:1000.5,origin:'Import documentat a la línia de pròrroga',note:'Import documentat; revisió econòmica en curs'});
 assert.equal(concertLineAmount(unit({act_type:'modification'}),undefined).amount,1000.5);
 assert.equal(concertLineAmount(unit({act_type:'termination',amount:'70'}),undefined).amount,-70,'documented cessaments go negative');
 assert.equal(concertLineAmount(unit({act_type:'renewal'}),review({status:'excluded'})).amount,null);
 assert.equal(concertLineAmount(unit({}),review({operation:'award',amount_cents:20000})).amount,200,'an approved review prevails over the annex');
 assert.deepEqual(concertLineAmount(unit({act_type:'legacy',unit_key:'legacy',amount:null}),undefined,{provisionAmount:'2500.00'}),{amount:2500,origin:'Import de la provisió aprovada',note:null});
 assert.deepEqual(concertLineAmount(unit({act_type:'legacy',unit_key:'legacy',amount:null}),undefined,{documentAmount:'11835.62'}),{amount:11835.62,origin:'Import global del document (extracció)',note:null});
 assert.equal(concertLineAmount(unit({act_type:'legacy',unit_key:'legacy',amount:null}),undefined,{provisionAmount:'10',documentAmount:'20'}).amount,10,'the approved provision prevails');
 const rectification=concertLineAmount(unit({act_type:'amendment'}),undefined,{rectifiedRecord:'etauler:1:9'});
 assert.equal(rectification.amount,null);assert.match(rectification.note!,/etauler:1:9.*no se suma/);
 assert.equal(concertLineAmount(unit({act_type:'amendment'}),undefined).amount,1000.5,'an amendment without original adds up');
 assert.equal(concertLineAmount(unit({act_type:'modification'}),review({operation:'delta',amount_cents:-5000})).amount,-50);
 assert.equal(concertLineAmount(unit({act_type:'termination'}),review({operation:'delta',amount_cents:7000})).amount,-70,'cessaments go negative');
 assert.equal(concertLineAmount(unit({act_type:'renewal'}),review({operation:'renewal',amount_cents:12000})).amount,120);
 assert.equal(concertLineAmount(unit({act_type:'modification'}),review({operation:'replacement',amount_cents:9000})).amount,null);
 assert.equal(concertLineAmount(unit({act_type:'renewal'}),review({operation:'renewal',amount_cents:12000,amount_kind:'unknown'})).amount,null);
 assert.equal(concertLineAmount(unit({act_type:'amendment'}),review({operation:'nonfinancial',amount_cents:null})).note,'Acte sense efecte econòmic');
});

test('province precedence: documentary geography, confirmed supplement, Idescat; conflicts stay pending',()=>{
 const documentary=concertLineProvince(unit({}),{unit_id:'u1',municipality:'Girona',county:'Gironès',province:'Girona'},undefined,undefined);
 assert.equal(documentary.province,'Girona');assert.equal(documentary.origin,'Geografia documental de la línia');
 const supplement={unit_id:'u1',municipality:'Lleida',county:'Segrià',province:'Lleida',decision:'confirmed',review_valid:true,review_id:'x',conflict:false,economic_review_context:null,id:1,source_url:'',source_sha256:'',source_captured_at:'',review_fingerprint:'',reviewer:null,rationale:null,reviewed_at:null};
 const applied=concertLineProvince(unit({territory:null}),undefined,supplement,undefined);
 assert.equal(applied.province,'Lleida');assert.equal(applied.origin,'Ubicació complementària confirmada (Idescat)');
 const conflict=concertLineProvince(unit({territory:'Vic'}),undefined,{...supplement,conflict:true},undefined);
 assert.equal(conflict.province,null);assert.match(conflict.note!,/conflicte/);
 const unknown=concertLineProvince(unit({territory:'Lloc inexistent'}),undefined,undefined,undefined);
 assert.equal(unknown.province,null);assert.equal(unknown.note,'Província no resolta: Lloc inexistent');
 assert.equal(concertLineProvince(unit({territory:null}),undefined,undefined,undefined).note,'Territori no identificat');
});

test('the award date prefers printed, then extracted, then digital, then the provision; ambiguity proposes nothing',()=>{
 const gates={supplementalGeography:false,signatureDates:true,printedDates:true,populationEvents:true};
 const enrichment={source_record_id:'r1',award_date:'2025-03-01',contracting_body:null,target_population:null,scope_facts:null};
 assert.equal(concertRecordAwardDate({documents:[document({})],signatures:[],enrichment,provision:undefined,gates}).date,'2025-03-10');
 assert.equal(concertRecordAwardDate({documents:[document({extracted_text:'## Pàgina 1\nSense signatura'})],signatures:[],enrichment,provision:undefined,gates}).origin,'Data extreta del document');
 const signature={source_record_id:'r1',document_id:'d1',document_sha256:'a'.repeat(64),claimed_utc:'2025-04-01T10:00:00Z',local_date:'2025-04-01',certificate_trust:'trusted',verification_method:'pdfsig-full-document-v1',observed_at:'2025-04-02T00:00:00Z'};
 const digital=concertRecordAwardDate({documents:[document({extracted_text:'## Pàgina 1\nSense signatura'})],signatures:[signature],enrichment:{...enrichment,award_date:null},provision:undefined,gates});
 assert.equal(digital.date,'2025-04-01');assert.match(digital.origin!,/digital/);
 assert.equal(concertRecordAwardDate({documents:[document({extracted_text:'## Pàgina 1\nSense signatura'})],signatures:[signature],enrichment:{...enrichment,award_date:null},provision:undefined,gates:{...gates,signatureDates:false}}).date,null);
 const stored=concertRecordAwardDate({documents:[document({})],signatures:[],enrichment:{...enrichment,award_date:null},provision:{source_record_id:'r1',unit_id:null,award_date:'2024-12-01',contracting_body:null,target_population:null,call_url:null},gates:{...gates,printedDates:false}});
 assert.equal(stored.date,'2024-12-01');assert.equal(stored.origin,'Provisió aprovada');
 const ambiguous=concertRecordAwardDate({documents:[document({extracted_text:'## Pàgina 1\nDoc. original signat per:\n  Conseller\n  10/03/2025\n\nDoc. original signat per:\n  Secretari\n  11/03/2025\n'})],signatures:[],enrichment:{...enrichment,award_date:null},provision:undefined,gates});
 assert.equal(ambiguous.date,null);assert.match(ambiguous.note!,/contradictòries|Diverses/);
});

test('legacy lines are skipped when the record has annex lines; corrections, population events and observed codes apply',()=>{
 const legacy=unit({id:'u0',unit_key:'legacy',act_type:'legacy',amount:'5000',service_code:null,catalog_version_id:null,observed_service_code:null,document_id:null,territory:null});
 const annex=unit({id:'u2',service_code:null,catalog_version_id:null,observed_service_code:'1.2.1.3',status:'draft',provider_name:null,observed_provider_name:'Entitat observada'});
 const corrected=unit({id:'u3',status:'rejected'});
 const result=concertRowsFromData(data({
  units:[legacy,annex,corrected],
  corrections:[{source_record_id:'r1',unit_id:'u3',field:'service_code',value:'1.1.6.1',valid:true},{source_record_id:'r1',unit_id:null,field:'provider_nif',value:'G99999999',valid:true},{source_record_id:'r1',unit_id:'u2',field:'provider_name',value:'Ignorada',valid:false}],
  populations:[{unit_id:'u2',job_id:'j1',sequence:1,decision:'unknown',value:null},{unit_id:'u2',job_id:'j1',sequence:2,decision:'confirmed',value:'Adolescents'},{unit_id:'u3',job_id:'old',sequence:9,decision:'confirmed',value:'Job antic'}],
 }),options);
 assert.equal(result.rows.length,2);
 assert.ok(result.notes.some(note=>note.startsWith('1 línies globals')));
 const [observed,rejected]=result.rows;
 assert.equal(observed.carteraCode,'1.2.1.3');assert.equal(observed.extras.codeOrigin,'Codi observat a l’annex');assert.equal(observed.providerName,'Entitat observada');
 assert.equal(observed.providerNif,'G99999999','record-level corrections apply to every line');
 assert.equal(observed.targetPopulation,'Adolescents');assert.equal(observed.extras.populationOrigin,'Població revisada per a la línia');
 assert.equal(rejected.extras.lineState,'Rebutjada');assert.ok(rejected.observations.includes('Línia rebutjada: no s’ha de sumar'));
 assert.equal(rejected.targetPopulation,'Infants en risc','events of another job are ignored');
 const alone=concertRowsFromData(data({units:[legacy],enrichments:[],gates:{supplementalGeography:false,signatureDates:false,printedDates:true,populationEvents:false}}),options);
 assert.equal(alone.rows.length,1);assert.ok(alone.notes.some(note=>note.includes('població revisades per línia no es poden llegir')));assert.equal(alone.rows[0].amount,5000);assert.equal(alone.rows[0].carteraCode,null);
 assert.ok(alone.rows[0].observations.includes('Codi pendent de revisió'));assert.ok(alone.rows[0].observations.includes('Òrgan no identificat'));
 assert.equal(alone.rows[0].sourceUrl,'https://tauler.example/edicte/100');
});

test('an amendment that repeats an exported line of another resolution is shown but not added up',()=>{
 const award=unit({id:'u1',source_record_id:'r1',period:'2024-10-01/2024-12-31',act_type:'renewal'});
 const amendment=unit({id:'u2',source_record_id:'r2',period:'2024-10-01/2024-12-31',act_type:'amendment'});
 const other=unit({id:'u3',source_record_id:'r2',unit_key:'official-annex:abc:1:2',period:'2024-10-01/2024-12-31',act_type:'amendment',amount:'999.00'});
 const result=concertRowsFromData(data({units:[award,amendment,other],records:[
  {id:'r1',source_record_id:'etauler:1:100',title:'Resolució de pròrroga',record_url:null},
  {id:'r2',source_record_id:'etauler:1:200',title:'Resolució de rectificació',record_url:null}]}),options);
 const byId=new Map(result.rows.map(row=>[row.extras.unitId,row]));
 assert.equal(byId.get('u1')!.amount,1000.5);
 assert.equal(byId.get('u2')!.amount,null);assert.equal(byId.get('u2')!.extras.documentedAmount,1000.5);
 assert.ok(byId.get('u2')!.observations.some(o=>o.includes('etauler:1:100')));
 assert.equal(byId.get('u3')!.amount,999,'a different amount is not a repetition');
 assert.ok(result.notes.some(n=>n.startsWith('1 línies d’esmena')));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractProgramAnnex,programCoverage,programDeclaredTotal} from '../lib/concerts/program-annex';
import {programServiceCode} from '../lib/concerts/program-service';
import {analysisDiagnostics} from '../lib/evidence-diagnostics';
import {normalizeCandidates} from '../lib/cloud/normalize-candidates';
import {recoverPdfText,preserveUnselectedPdfPages} from '../lib/pipeline/readable-document';
import {validateOcrRecovery} from '../lib/ocr-recovery';
import {compareSourceField} from '../lib/source-comparison';
import {identifyPriorObservation} from '../lib/concerts/observation-identity';
import {readPages} from '../lib/read-pages';
import catalog from '../data/legal/cartera.json';
import type {OfficialService} from '../lib/official-catalog';
import type {AnalysisOutput} from '../lib/analysis-contract';

const headings=['NIF entitat','Nom entitat','GECAT','Disposició','Posició','finalista','inici','fi','Import assignat','Partida pressupostària','jurídic','FUE','Codi S','Nom servei','Municipi','Tipologia de servei','Places','Cost anual','Cost anual amb IVA'];
function table(offset=0){
 const widths=headings.map(h=>Math.max(h.length+3,h==='Nom entitat'?30:h==='Tipologia de servei'?65:18));
 const row=(cells:Record<string,string>)=>' '.repeat(offset)+headings.map((h,i)=>(cells[h]??'').padEnd(widths[i])).join('');
 const header=row(Object.fromEntries(headings.map(h=>[h,h])));
 return {row,header};
}
test('independent territorial totals reconcile only against their own complete tables',()=>{
 const {row,header}=table();
 const section=(page:number,code:string,amount:string)=>[`## Pàgina ${page}`,header,row({'NIF entitat':'G12345678','Nom entitat':'Entitat','Disposició':`260000000${page}`,'Codi S':code,'Import assignat':amount,'Cost anual':amount,'Cost anual amb IVA':amount}),`Total\ngeneral  ${amount}`].join('\n');
 const first=section(1,'S01234','100,01 €'),second=section(2,'S01235','200,02 €');
 const text=first+'\n'+second,rows=extractProgramAnnex(text);
 assert.equal(programDeclaredTotal(text,rows),30003);
 assert.equal(programDeclaredTotal(text.replace('general  100,01','general  200,02').replace(/general  200,02(?= €$)/,'general  100,01'),rows),null,'swapping totals must not reconcile by aggregate alone');
 assert.equal(programDeclaredTotal(text+'\nTotal general 300,03 €',rows),30003);
 assert.equal(programDeclaredTotal(text+'\n'+section(3,'S01236','1,00 €').split('Total')[0],extractProgramAnnex(text+'\n'+section(3,'S01236','1,00 €').split('Total')[0])),null,'unaccounted rows cannot disappear');
});
test('detected columns preserve wrapped names and allocate every cent using all tariff components',()=>{
 for(const offset of [0,9,37]){
  const {row,header}=table(offset);
  const text=['## Pàgina 4',header,row({'Nom entitat':'Associació de serveis'}),
   row({'NIF entitat':'G12345678','Nom entitat':'socials de prova','Disposició':'2600000001','Posició':'1','Import assignat':'100,01 €','Codi S':'S01234','Tipologia de servei':'Servei de centre de dia per a gent gran','Places':'2','Cost anual':'300,00 €','Cost anual amb IVA':'312,00 €'}),
   ' '.repeat(400)+'3   200,00 €   208,00 €',
   row({'Codi S':'S01235','Tipologia de servei':'Servei de centre de dia per a gent gran','Places':'1','Cost anual':'500,00 €','Cost anual amb IVA':'520,00 €'})].join('\n');
  const rows=extractProgramAnnex(text);
  assert.equal(rows.length,2);assert.equal(rows[0].observedProviderName,'Associació de serveis socials de prova');
  assert.equal(rows[0].quantity,5);assert.equal(rows[0].annualCostCents,50000);
  assert.deepEqual(rows.map(r=>r.amountCents),[5001,5000]);assert.ok(rows.every(r=>r.amountBasis==='allocated'));
  assert.ok(rows.every(r=>text.replace(/\s+/g,' ').includes(r.quote)));
  assert.equal(programCoverage(text,rows).complete,true);
 }
});
test('positions of one disposition are distinct budgets; missing weights never invent a distribution',()=>{
 const {row,header}=table();const make=(code:string,pos:string,amount:string,cost:string)=>row({'NIF entitat':code==='S01234'?'G12345678':'','Nom entitat':code==='S01234'?'Entitat test':'','Disposició':code==='S01234'?'2600000001':'','Posició':pos,'Import assignat':amount,'Codi S':code,'Cost anual':cost,'Cost anual amb IVA':cost});
 const rows=extractProgramAnnex([header,make('S01234','1','100,00 €','10,00 €'),make('S01235','2','200,00 €','20,00 €')].join('\n'));
 assert.deepEqual(rows.map(r=>r.amountCents),[10000,20000]);
 const incomplete=extractProgramAnnex([header,make('S01234','1','100,00 €',''),make('S01235','','','20,00 €')].join('\n'));
 assert.ok(incomplete.every(r=>r.amountCents===null));
});
test('unknown identity and missing parsed rows are an incomplete annex',()=>{
 const text='S12345 12,00 €\nS12346 13,00 €';assert.equal(extractProgramAnnex(text).length,0);assert.deepEqual(programCoverage(text,[]),{candidateRows:2,extractedRows:0,unresolvedRows:2,complete:false,missingAmounts:0});
});
test('documented group codes retain their level; vague or conflicting populations do not select a code',()=>{
 const services=catalog.services as OfficialService[];
 assert.equal(programServiceCode('Residència assistida per a gent gran - temporal o permanent',services),'1.2.3.3.2');
 assert.equal(programServiceCode('Servei de teràpia ocupacional-discapacitats intel·lectuals',services),'1.2.6.2.4.1');
 assert.equal(programServiceCode('Centre de dia per a gent gran i discapacitats físics',services),null);
 assert.equal(programServiceCode('Servei Girona per a g',services),null);
 assert.equal(programServiceCode('Residència assistida per a gent gran',[]),null);
});
test('diagnostics separate missing facts, invalid citations and contradictory facts',()=>{
 const result=analysisDiagnostics({classification:'insufficient_evidence',explanation:'La resolució sí que acredita el servei.',rule_audit:{rule:'unknown_determinant_role',blocked_roles:[{role:'final_service',reason:'missing_fact'},{role:'final_population',reason:'unverifiable_quote'},{role:'financed_object',reason:'contradictory'}]}});
 assert.deepEqual(result.map(d=>d.code),['missing_fact','unverifiable_quote','contradictory']);
 assert.match(result[1].message,/cita no es pot verificar/);assert.ok(result.every(d=>!d.message.includes('sí que acredita')));
 const legacy=analysisDiagnostics({classification:'insufficient_evidence',explanation:'old',rule_audit:{rule:'unknown_determinant_role'}});
 assert.match(legacy[0].message,/no va registrar/);
});
test('failed compatibility cannot append a contradictory positive model explanation',()=>{
 const service=(catalog.services as OfficialService[]).find(s=>s.service_code==='1.2.3.1')!;
 const input:AnalysisOutput={classification:'in_portfolio',explanation:'Tota la documentació acredita adequadament la correspondència.',service_description:'Servei',target_population:'gent gran',evidence_ordinals:[1],population_verified:false,social_service_verified:true,reasons:[],candidates:[{code:service.service_code,score:1,rationale:'test',evidence_ordinals:[1],evidence_explanation:'test',population_compatible:true,legal_reference:service.legal_reference}]};
 const output=normalizeCandidates(input,catalog.services as OfficialService[],1);assert.equal(output.classification,'insufficient_evidence');assert.match(output.explanation,/destinataris/);assert.doesNotMatch(output.explanation,/adequadament/);
});
test('targeted OCR re-reads only selected pages even when old text is readable',async()=>{
 const raw='Text llegible del document oficial amb més de cinquanta caràcters.';const calls:number[]=[];
 const result=await recoverPdfText(raw+'\f'+raw,true,async page=>{calls.push(page);return 'Nova lectura documental verificada de la pàgina seleccionada.';},2,[2]);
 assert.deepEqual(calls,[2]);assert.equal(result.coverage.pages[0].method,'text');assert.equal(result.coverage.pages[1].method,'ocr');
 await assert.rejects(recoverPdfText(raw,true,async()=>raw,1,[2]));
 assert.throws(()=>validateOcrRecovery({documentId:'wrong',pages:[1]}));
 assert.throws(()=>validateOcrRecovery({documentId:'219d6f13-5531-47d0-bebc-4e78123ef7ee',pages:[0]}));
});
test('Excel priority preserves zero and distinguishes absent data from discrepancies',()=>{
 const zero=compareSourceField('Import',0,100);assert.equal(zero.effective,0);assert.equal(zero.origin,'Excel');assert.equal(zero.status,'Discrepància');
 assert.equal(compareSourceField('Entitat',null,'Entitat oficial').origin,'Document');
 assert.equal(compareSourceField('Entitat','Entitat',null).status,'Falta al document');
 assert.equal(compareSourceField('Entitat','Associació','Associacio').status,'Coincideix');
 assert.equal(compareSourceField('Import',NaN,10).status,'Valor no vàlid');
});
test('amendment reads the expressly reproduced final annex and preserves original page numbers',()=>{
 const {row,header}=table();
 const data=row({'NIF entitat':'G12345678','Nom entitat':'Entitat','Disposició':'2600000001','Codi S':'S01234','Tipologia de servei':'Centre de dia per a gent gran','Cost anual':'50,00 €','Cost anual amb IVA':'50,00 €','Import assignat':'25,00 €'});
 const text=['## Pàgina 1','Resolc: Reproduir en la seva totalitat la resolució a l’Annex 2.',header,data,'## Pàgina 4','Annex 2: Text corregit',header,data].join('\n');
 const rows=extractProgramAnnex(text);assert.equal(rows.length,1);assert.equal(rows[0].page,4);assert.equal(rows[0].amountCents,2500);assert.equal(programCoverage(text,rows).candidateRows,1);
});
test('existing identifiers follow documentary tariff rows, not their order in a database response',()=>{
 const base={provider_nif:'G12345678',reses_code:'S01234',page:4};
 const previous=[{...base,id:'second',unit_key:'old:2',evidence_quote:'2600000001 S01234 20,00 € 20,00 €'}, {...base,id:'first',unit_key:'old:1',evidence_quote:'2600000001 S01234 10,00 € 10,00 €'}];
 const row={nif:'G12345678',resesCode:'S01234',page:4,dispositionNumber:'2600000001',quote:'full name 2600000001 S01234 10,00 € 10,00 €'};
 assert.equal(identifyPriorObservation(previous,new Set(),row,'new')?.id,'first');
 assert.throws(()=>identifyPriorObservation([...previous,{...previous[1],id:'duplicate'}],new Set(),row,'new'),/AMBIGUOUS/);
});
test('documented concert parent codes are allowed only with an explicit whitelist',()=>{
 const services=catalog.services as OfficialService[],service=services.find(s=>s.service_code==='1.2.3.3.2')!;
 const value:AnalysisOutput={classification:'in_portfolio',explanation:'La tipologia genèrica està acreditada.',service_description:service.service_name,target_population:'gent gran',evidence_ordinals:[1],population_verified:true,social_service_verified:true,reasons:[],candidates:[{code:service.service_code,score:1,rationale:'document',evidence_ordinals:[1],evidence_explanation:'literal',population_compatible:true,legal_reference:service.legal_reference}]};
 assert.throws(()=>normalizeCandidates(value,services,1));
 assert.equal(normalizeCandidates(value,services,1,new Set([service.service_code])).candidates[0].code,service.service_code);
});
test('all line revisions are read beyond the database default limit and failures are not partial successes',async()=>{
 const data=Array.from({length:1203},(_,i)=>i);const result=await readPages(async(from,to)=>({data:data.slice(from,to+1),error:null}));assert.deepEqual(result,data);
 await assert.rejects(readPages(async()=>({data:[1],error:Error('database unavailable')})),/database unavailable/);
 assert.doesNotThrow(()=>analysisDiagnostics({classification:'insufficient_evidence',explanation:'Anàlisi antiga pendent de repetir.',rule_audit:{diagnostics:[null,{}],blocked_roles:{bad:true}}}));
});

test('targeted recovery retains previous OCR and page boundaries outside the selected pages',()=>{
 const previous='## Pàgina 1\n\nText OCR anterior de primera.\n\n## Pàgina 2\n\nLectura vella segona.\n\n## Pàgina 3\n\nText OCR anterior tercera.';
 assert.equal(preserveUnselectedPdfPages('mala1\fmala2\fmala3',previous,[2],3),'Text OCR anterior de primera.\fmala2\fText OCR anterior tercera.');
});

test('equipment codes cannot leak the preceding entity or budget into later RESES rows',()=>{
 const {row,header}=table();const line=(nif:string,code:string,da:string,amount:string)=>row({'NIF entitat':nif,'Nom entitat':nif?'Entitat '+nif:'','Disposició':da,'Posició':'1','Import assignat':amount,'Codi S':code,'Tipologia de servei':code.startsWith('C')?'Casal per a Gent Gran':'Centre de dia per a gent gran','Cost anual':'100,00 €','Cost anual amb IVA':'104,00 €'});
 const text=[header,line('A12345678','S01234','2600000001','100,00 €'),line('B12345678','C01235','2600000002','200,00 €'),line('','S01236','','')].join('\n');
 const rows=extractProgramAnnex(text);assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.nif),['A12345678','B12345678','B12345678']);assert.deepEqual(rows.map(r=>r.amountCents),[10000,10000,10000]);assert.equal(programCoverage(text,rows).complete,true);
});

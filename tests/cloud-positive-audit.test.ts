import {test} from 'node:test';
import {splitText} from '../lib/pipeline/chunks';
import assert from 'node:assert/strict';
import {applyPositiveAudit,insufficientWithoutPositiveQuote,positiveAuditSchema} from '../lib/cloud/positive-audit';
import type {OfficialService} from '../lib/official-catalog';
import {applyFinancingClassification,type AnalysisOutput} from '../lib/analysis-contract';
const all=[{service_code:'1.1',service_name:'Llar autònoma',benefit_type:'service'},{service_code:'1.2',service_name:'Residència assistida',benefit_type:'service'}] as OfficialService[];
const chunks=[{content:'El servei presta assistència residencial a persones dependents.'}];
const candidate=(code:string,score:number)=>({code,score,rationale:'initial',evidence_ordinals:[1],evidence_explanation:'initial',population_compatible:true,legal_reference:'reference'});
const result={classification:'in_portfolio',candidates:[candidate('1.1',.9),candidate('1.2',.8)],reasons:[],explanation:'initial',evidence_ordinals:[1],population_verified:true,social_service_verified:true,service_description:'residència',target_population:'dependents'} as AnalysisOutput;
const checks=[{code:'1.1',service_name:'Llar autònoma',compatible:false,explanation:'No acredita autonomia suficient per a una llar.',evidence_ordinal:1,quote:''},{code:'1.2',service_name:'Residència assistida',compatible:true,explanation:'Acredita assistència residencial a persones dependents.',evidence_ordinal:1,quote:'assistència residencial a persones dependents'}];
test('Specific positive audit removes incompatible higher-scored candidate without inventing replacements',()=>{const v=applyPositiveAudit(result,{checks},all,chunks);assert.equal(v.classification,'in_portfolio');assert.deepEqual(v.candidates.map(c=>[c.code,c.score]),[['1.2',.8]]);assert.equal(result.candidates.length,2);});
test('No compatible candidate means insufficient evidence, never out of portfolio',()=>{const v=applyPositiveAudit(result,{checks:checks.map(c=>({...c,compatible:false}))},all,chunks);assert.equal(v.classification,'insufficient_evidence');assert.deepEqual(v.candidates,[]);});
test('an uncited positive audit becomes uncertainty without weakening strict evidence checks',()=>{
 const invalid={checks:[checks[0],{...checks[1],quote:''}]};
 assert.throws(()=>applyPositiveAudit(result,invalid,all,chunks));
 const fallback=insufficientWithoutPositiveQuote(result,invalid);
 assert.ok(fallback);
 assert.equal(fallback.classification,'insufficient_evidence');
 assert.deepEqual(fallback.candidates,[]);
 assert.equal(result.classification,'in_portfolio');
 assert.equal(insufficientWithoutPositiveQuote(result,{checks}),null);
});
test('Audit rejects missing, repeated, invented, misnamed and unsupported evidence results',()=>{for(const invalid of [checks.slice(1),[checks[1],checks[1]],[checks[0],{...checks[1],code:'1.3'}],[checks[0],{...checks[1],service_name:'Llar autònoma'}],[checks[0],{...checks[1],quote:'Aquesta cita és inventada'}],[checks[0],{...checks[1],evidence_ordinal:2}]])assert.throws(()=>applyPositiveAudit(result,{checks:invalid},all,chunks));});
test('Audit preserves score ordering and only permits proposed codes',()=>{const v=applyPositiveAudit(result,{checks:checks.map(c=>({...c,compatible:true,quote:checks[1].quote}))},all,chunks);assert.deepEqual(v.candidates.map(c=>c.score),[.9,.8]);assert.deepEqual(positiveAuditSchema(['1.1']).properties.checks.items.properties.code.enum,['1.1']);});

test('Audit quote choices come exclusively from document text',()=>{const choices=positiveAuditSchema(['1.2'],chunks).properties.checks.items.properties.quote.enum;assert.deepEqual(choices,['',chunks[0].content]);});

test('a legal appeal citation alone cannot support a positive service match',()=>{
 const quote='10.1.a) de la Llei 29/1998, de 13 de juliol, reguladora de la jurisdicció contenciosa';
 const evidence=[{content:quote}];
 const audit={checks:[checks[0],{...checks[1],quote,explanation:'La cita és compatible amb el servei proposat.'}]};
 const resolved=applyPositiveAudit(result,audit,all,evidence);
 assert.equal(resolved.classification,'insufficient_evidence');
 assert.equal(resolved.candidates.length,0);
 assert.match(resolved.explanation,/Proposta original/);
 assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
});

const appealContinuation='administrativa, davant el Tribunal Superior de Justícia de Catalunya, en el termini de';
const appealParagraph="Així mateix, es pot interposar un recurs contenciós administratiu, d’acord amb l’article\n10.1.a) de la Llei 29/1998, de 13 de juliol, reguladora de la jurisdicció contenciosa\n"+appealContinuation+'\ndos mesos a comptar de l’endemà de la seva notificació.';
test('S1-18 procedural continuation retains its paragraph context in both schema and validation',()=>{
 const evidence=[{content:appealParagraph}];
 const reply={checks:[checks[0],{...checks[1],quote:appealContinuation}]};
 assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(appealContinuation));
 const resolved=applyPositiveAudit(result,reply,all,evidence);
 assert.equal(resolved.classification,'insufficient_evidence');assert.deepEqual(resolved.candidates,[]);
 assert.match(resolved.explanation,/paràgraf.*recurs/);
 assert.equal(reply.checks[1].compatible,true);
});

test('a separate substantive paragraph remains usable beside a procedural paragraph',()=>{
 const evidence=[{content:chunks[0].content+'\n\n'+appealParagraph}];
 const quote=chunks[0].content;
 assert.ok(positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
 const resolved=applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence);
 assert.equal(resolved.classification,'in_portfolio');assert.equal(resolved.candidates[0].evidence_explanation,quote);
});

test('single line breaks do not lend a preceding service statement to a procedural continuation',()=>{
 for(const financingType of ['concert','contractacio','subvencio'])for(const separator of ['\n','\r\n',' ']){
  const substantive='El servei presta assistència residencial a persones dependents.';
  const evidence=[{content:substantive+separator+appealParagraph}];
  const original=applyFinancingClassification({...result,candidates:[result.candidates[1]]},financingType);
  const choices=positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!;
  assert.ok(choices.includes(substantive));assert.ok(!choices.includes(appealContinuation));
  assert.equal(applyPositiveAudit(original,{checks:[{...checks[1],quote:substantive}]},all,evidence).classification,'in_portfolio');
  assert.equal(applyPositiveAudit(original,{checks:[{...checks[1],quote:appealContinuation}]},all,evidence).classification,'insufficient_evidence');
 }
});

test('a literal repeated before and inside an appeal span is ambiguous, not overwritten by its last occurrence',()=>{
 const quote='L’atenció descrita es manté durant el període establert.';
 const evidence=[{content:chunks[0].content+' '+quote+'\n'+appealParagraph+'\n'+quote}];
 assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
 const pending=applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence);
 assert.equal(pending.classification,'insufficient_evidence');assert.match(pending.explanation,/únic context/);
 const crossing=chunks[0].content+' '+quote+'\nAixí mateix';
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:crossing}]},all,evidence).classification,'insufficient_evidence');
});

test('a new operative clause ends the appeal span and a service description is not a procedural introduction',()=>{
 const award='Assignar el servei de residència assistida per a persones dependents.';
 const evidence=[{content:appealParagraph+'\nRESOLC:\n1. '+award}];
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:award}]},all,evidence).classification,'in_portfolio');
 const service='El servei presta assistència residencial i orienta les persones sobre com interposar un recurs quan ho necessiten.';
 const ordinary=[{content:service}];
 assert.ok(positiveAuditSchema(['1.2'],ordinary).properties.checks.items.properties.quote.enum!.includes(service));
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:service}]},all,ordinary).classification,'in_portfolio');
});

test('a numbered appeal clause starts a procedural span without absorbing the previous service statement',()=>{
 const continuation='davant la persona titular del Departament de Drets Socials en el termini establert.';
 const evidence=[{content:chunks[0].content+'\n6. Contra la resolució, es pot interposar recurs de reposició\n'+continuation}];
 assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(continuation));
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:continuation}]},all,evidence).classification,'insufficient_evidence');
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:chunks[0].content}]},all,evidence).classification,'in_portfolio');
});

test('contract and grant fixtures retain substantive citations and leave procedural citations pending',()=>{
 for(const financingType of ['contractacio','subvencio']){
  const substantive=financingType==='contractacio'
   ?'El contracte adjudica el servei de residència assistida per a persones dependents.'
   :'La subvenció finança el servei de residència assistida per a persones dependents.';
  const evidence=[{content:substantive+'\n\n'+appealParagraph}];
  const original=applyFinancingClassification({...result,candidates:[result.candidates[1]]},financingType);
  const choices=positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!;
  assert.ok(choices.includes(substantive));assert.ok(!choices.includes(appealContinuation));
  const accepted=applyPositiveAudit(original,{checks:[{...checks[1],quote:substantive}]},all,evidence);
  assert.equal(accepted.classification,'in_portfolio');assert.equal(accepted.candidates[0].evidence_explanation,substantive);
  const pending=applyPositiveAudit(original,{checks:[{...checks[1],quote:appealContinuation}]},all,evidence);
  assert.equal(pending.classification,'insufficient_evidence');assert.deepEqual(pending.candidates,[]);
 }
});

test('all occurrences are checked when one literal has different substantive and procedural contexts',()=>{
 const quote='L’atenció descrita es manté durant el període establert.';
 const substantive='El servei presta assistència residencial a persones dependents. '+quote;
 const procedural='Es pot interposar un recurs contenciós administratiu. '+quote;
 for(const evidence of [[{content:substantive},{content:procedural}],[{content:procedural},{content:substantive}],[{content:substantive+'\n\n'+procedural}]]){
  assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
  const resolved=applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence);
  assert.equal(resolved.classification,'insufficient_evidence');assert.match(resolved.explanation,/únic context/);
 }
 // Removing the conflicting occurrence leaves the substantive context usable.
 assert.ok(positiveAuditSchema(['1.2'],[{content:substantive}]).properties.checks.items.properties.quote.enum!.includes(quote));
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,[{content:substantive}]).classification,'in_portfolio');
});

test('a quote spanning separate paragraphs stays pending and an unlocated quote remains invalid',()=>{
 const evidence=[{content:chunks[0].content+'\n\n'+appealParagraph}];
 const spanning=chunks[0].content+'\n\nAixí mateix';
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:spanning}]},all,evidence).classification,'insufficient_evidence');
 assert.throws(()=>applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:'Una afirmació prou llarga que no existeix al document'}]},all,evidence),/POSITIVE_AUDIT_EVIDENCE/);
});

test('many rejected contexts do not hide later substantive evidence or exceed the existing quote limit',()=>{
 const repeated=Array.from({length:500},(_,index)=>`Afirmació compartida número ${String(index).padStart(4,'0')} amb context pendent de comprovació.`).join('\n');
 const late='El servei presta assistència residencial a persones dependents amb suport continuat.';
 const evidence=Array.from({length:24},(_,index)=>({content:`Context específic del fragment ${index}.\n${repeated}${index===23?'\n\n'+late:''}`}));
 const choices=positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!;
 assert.ok(choices.includes(late),'the scan must reach substantive text after more than 400 ambiguous literals');
 assert.ok(!choices.includes(repeated.split('\n')[0]));
 assert.ok(choices.length<=201,'200 accepted choices plus the empty choice');
});

test('literal quotation can resolve one misplaced in-range ordinal without changing the text',()=>{
 const evidence=[{content:'Other synthetic source, unrelated.'},...chunks];
 const result2=applyPositiveAudit(result,{checks},all,evidence);assert.deepEqual(result2.candidates[0].evidence_ordinals,[2]);assert.equal(checks[1].evidence_ordinal,1);
});
test('repeated literal quotation retains all matching sources rather than choosing arbitrarily',()=>{
 const evidence=[{content:'Other synthetic source, unrelated.'},...chunks,...chunks];
 const resolved=applyPositiveAudit(result,{checks},all,evidence);assert.deepEqual(resolved.candidates[0].evidence_ordinals,[2,3]);assert.deepEqual(resolved.evidence_ordinals,[2,3]);
});

test('strict audit schema uses literal spans without unsupported quoted/control characters',()=>{
 const content='El servei residencial "Centre de suport a persones grans" ofereix atenció.\u0000Altres condicions documentades.';
 const choices=positiveAuditSchema(['1.2'],[{content}]).properties.checks.items.properties.quote.enum!;
 assert.ok(choices.includes('Centre de suport a persones grans'));
 assert.ok(choices.filter(Boolean).every(text=>content.includes(text)&&!/["\\\p{Cc}\p{Cs}]/u.test(text)));
});

test('audit choices exclude generic headers and prefer the exact official service annex',()=>{
 const service={...all[1],service_code:'1.2.3.3.2.2',service_name:'Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau II'} as OfficialService;
 const evidence=[
  {content:'R/N: 21728/CS00210\nResolució de l’expedient: 26-000234-AP'},
  {content:'1.2.3.3.2.2 Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau II'},
 ];
 const choices=positiveAuditSchema([service.service_code],evidence,[service]).properties.checks.items.properties.quote.enum!;
 assert.ok(!choices.includes('R/N: 21728/CS00210'));
 assert.ok(!choices.includes('Resolució de l’expedient: 26-000234-AP'));
 assert.ok(choices.some(choice=>choice.includes('1.2.3.3.2.2')));
 assert.ok(choices.filter(Boolean).every(choice=>evidence.some(chunk=>chunk.content.includes(choice))));
});
test('an explicitly cited service does not hide evidence for a different candidate',()=>{
 const service={...all[1],service_code:'1.2.3.3.2.2',service_name:'Servei de residència assistida per a gent gran de caràcter temporal o permanent'} as OfficialService;
 const other='El servei de tutela acompanya persones amb malaltia mental de forma continuada.';
 const evidence=[{content:`1.2.3.3.2.2 ${service.service_name}.`},{content:other}];
 const choices=positiveAuditSchema([service.service_code,'1.1'],evidence,[service,all[0]]).properties.checks.items.properties.quote.enum!;
 assert.ok(choices.includes(other));
});


test('substantive wording before an explicit appeal remains usable without service keywords',()=>{
 const quote='Allotjament i acompanyament educatiu per a joves tutelats amb suport diari.';
 const evidence=[{content:quote+'\n'+appealParagraph}];
 assert.ok(positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
 for(const type of ['concert','contractacio','subvencio'])assert.equal(applyFinancingClassification(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence),type).classification,'in_portfolio');
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:appealContinuation}]},all,evidence).classification,'insufficient_evidence');
});

test('one physical citation in a proven consecutive chunk overlap retains its source context',()=>{
 const quote='El servei presta assistència residencial a persones dependents';
 const text='Context documental '.repeat(57)+'\n'+quote+'\n'+'Informació complementària '.repeat(35);
 const evidence=splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:'source-a'}));
 assert.equal(text.split(quote).length-1,1);assert.equal(evidence.filter(c=>c.content.includes(quote)).length,2);
 assert.ok(positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence).classification,'in_portfolio');
});

test('missing, conflicting or nonconsecutive provenance does not join a duplicate quote',()=>{
 const quote='El servei presta assistència residencial a persones dependents';
 const text='Context documental '.repeat(57)+'\n'+quote+'\n'+'Informació complementària '.repeat(35);
 const original=splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:'source-a'}));
 const variants=[original.map(({content})=>({content})),[original[0],{...original[1],ordinal:3}],
  [original[0],{...original[1],source_document_id:'source-b'}],
  [original[0],{...original[1],ordinal:0}],
  [...original,{...original[0],content:'Un altre fragment amb el mateix ordinal.'}]];
 for(const evidence of variants){
  assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
  const out=applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence);
  assert.equal(out.classification,'insufficient_evidence');assert.match(out.explanation,/únic context/);
 }
});

test('a genuinely different occurrence is not erased when another pair overlaps',()=>{
 const quote='El servei presta assistència residencial a persones dependents';
 const text='Context documental '.repeat(57)+'\n'+quote+'\n'+'Informació complementària '.repeat(35);
 const evidence=[...splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:'source-a'})),{source_document_id:'source-b',ordinal:0,content:'Descripció d’un altre expedient.\n'+quote}];
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence).classification,'insufficient_evidence');
});

test('splitter whitespace and surrogate handling preserve exact-source quotes across financing types',()=>{
 const quote='El servei presta assistència residencial a persones dependents';
 for(const prefix of ['Context documental '.repeat(57),'Context documental '.repeat(56)+'😀 suplement ', 'Context documental '.repeat(57)+'  \n ']){
  const text=prefix+'\n'+quote+'\n'+'Informació complementària '.repeat(35);
  const evidence=splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:'source-a'}));
  assert.equal(evidence.filter(c=>c.content.includes(quote)).length,2);
  assert.ok(positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(quote));
  for(const type of ['concert','contractacio','subvencio'])assert.equal(applyFinancingClassification(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote}]},all,evidence),type).classification,'in_portfolio');
 }
});

test('joining an exact overlap cannot detach an appeal continuation from its introduction',()=>{
 const text='Context documental '.repeat(47)+'\n'+appealParagraph+'\n'+'Informació complementària '.repeat(35);
 const evidence=splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:'source-a'}));
 const ordinal=evidence.findIndex(c=>c.content.includes(appealContinuation))+1;
 assert.ok(ordinal>0);
 assert.ok(!positiveAuditSchema(['1.2'],evidence).properties.checks.items.properties.quote.enum!.includes(appealContinuation));
 assert.equal(applyPositiveAudit(result,{checks:[checks[0],{...checks[1],quote:appealContinuation,evidence_ordinal:ordinal}]},all,evidence).classification,'insufficient_evidence');
});

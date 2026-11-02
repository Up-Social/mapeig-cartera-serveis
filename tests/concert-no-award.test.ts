import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertNoAwardTitle} from '../lib/concerts/no-award';

test('unambiguous denial and nonfinal proposal do not become financing',()=>{
 assert.equal(concertNoAwardTitle('RESOLUCIÓ de denegació de la sol·licitud de TALMA')?.kind,'denial');
 assert.equal(concertNoAwardTitle('Acord proposta del Comitè de Provisió de Serveis Socials')?.kind,'proposal');
 assert.equal(concertNoAwardTitle('Acord proposta d’adjudicació de serveis de concert social')?.kind,'proposal');
 assert.equal(concertNoAwardTitle('Resolució d’adjudicació de places segons la proposta anterior'),null);
});
test('a mixed renewal with spending and an award mentioning denial require PDF analysis',()=>{
 assert.equal(concertNoAwardTitle('Pròrroga i autorització de la despesa'),null);
 assert.equal(concertNoAwardTitle('Resolució d’adjudicació de places i denegació de les restants'),null);
});
test('a call cited in the title does not discard the later final award',()=>{
 const title='Resolució de la convocatòria IFE/1632/2025_ Provisió de Serveis SIE Hospitalet 2025-2029';
 const official='Resolució de provisió dels serveis socials. Identificació de la convocatòria IFE/1632/2025. Resolc: 1. Assignar el Servei d’Intervenció Especialitzada a l’entitat INTRESS.';
 assert.equal(concertNoAwardTitle(title),null);
 assert.equal(concertNoAwardTitle(title,official),null);
 assert.equal(concertNoAwardTitle('Resolució DSI/3434/2024 de convocatòria anticipada per a la provisió de places')?.kind,'call');
 assert.equal(concertNoAwardTitle('Proposta de resolució per a la provisió de places','Resolc: 1. Assignar el servei a una entitat.')?.kind,'proposal');
});

test('operative clauses win over mixed title wording without relying on a case name',()=>{
 for(const title of ['Resolució de places denegades i assignades','Resolució de convocatòria de serveis','Resolució de places desertes']){
  for(const text of ['RESOLC\n1. Assignar els serveis a les entitats de l’annex.',
   'Resolc: 1. Denegar les peticions de l’annex 1. 2. Adjudicar les places de l’annex 2.']){
   assert.equal(concertNoAwardTitle(title,text),null);
  }
 }
});
test('negated or proposed awards cannot defeat a no-award decision',()=>{
 for(const text of ['Resolc: 1. No adjudicar les places.','Resolc: 1. Proposar adjudicar les places.'])
  assert.equal(concertNoAwardTitle('Resolució de places denegades',text)?.kind,'denial');
});

test('a deterministic no-award decision requires the entire known window and a relevant citation',async()=>{
 const {concertNoAwardFromEvidence}=await import('../lib/concerts/no-award');
 const title='Resolució de places denegades';
 const denial={id:'1',source_document_id:'doc',content:'Resolc: 1. Denegar les places de l’annex.',eligible:true};
 const award={id:'2',source_document_id:'doc',content:'Resolc: 2. Adjudicar les places de l’annex següent.',eligible:true};
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'}],[denial,award],[denial]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'}],[denial,award],[denial,award]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'},{id:'other'}],[denial],[denial]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'}],[{...denial,eligible:false}],[denial]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'}],[{...denial,content:'Un document sense el motiu'}],[{...denial,content:'Un document sense el motiu'}]),null);
 const distant={id:'3',source_document_id:'other',content:'Resolc: 1. Denegar les peticions. '+ 'Antecedents. '.repeat(600) + '2. Adjudicar les places restants.',eligible:true};
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'},{id:'other'}],[denial,distant],[denial,distant]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'doc'}],[denial],[denial])?.evidenceOrdinal,1);
});

test('a generic portal with unverified coverage and a truncated PDF window cannot justify discard',async()=>{
 const {concertNoAwardFromEvidence}=await import('../lib/concerts/no-award');
 const title='Resolució de places desertes';
 const documents=[{id:'pdf'},{id:'portal'}];
 const pdf={id:'p1',source_document_id:'pdf',content:'Resolc: 1. Declarar les places desertes.',eligible:true};
 const shell={id:'h1',source_document_id:'portal',content:'E-tauler - Consorci Administració Oberta de Catalunya',eligible:false};
 assert.equal(concertNoAwardFromEvidence(title,documents,[pdf,shell],[pdf]),null);
 const second={id:'p2',source_document_id:'pdf',content:'Resolc: 2. Adjudicar altres places.',eligible:true};
 assert.equal(concertNoAwardFromEvidence(title,[{id:'pdf'}],[pdf,second],[pdf]),null);
 assert.equal(concertNoAwardFromEvidence(title,[{id:'pdf'}],[pdf,second],[pdf,second]),null);
});

test('a stale pinned chunk or inconsistent document set cannot support a deterministic discard',async()=>{
 const {concertNoAwardFromEvidence}=await import('../lib/concerts/no-award');
 const title='Resolució de places desertes';
 const documents=[{id:'pdf'}];
 const current={id:'p1',source_document_id:'pdf',content:'Resolc: 1. Declarar les places desertes.',eligible:true};
 assert.equal(concertNoAwardFromEvidence(title,documents,[current],[{...current,content:'Antiga cita sobre places desertes.'}]),null);
 assert.equal(concertNoAwardFromEvidence(title,documents,[current],[{...current,source_document_id:'other'}]),null);
 assert.equal(concertNoAwardFromEvidence(title,documents,[current,current],[current,current]),null);
 assert.equal(concertNoAwardFromEvidence(title,[...documents,...documents],[current],[current]),null);
 assert.equal(concertNoAwardFromEvidence(title,documents,[current,{...current,id:'p2',source_document_id:'other'}],[current,{...current,id:'p2',source_document_id:'other'}]),null);
 assert.equal(concertNoAwardFromEvidence(title,documents,[current],[current])?.evidenceOrdinal,1);
});

test('an award mentioned outside a recognized Resolc heading prevents title-only discard',async()=>{
 const {concertNoAwardFromEvidence}=await import('../lib/concerts/no-award');
 const title='Resolució de places desertes';
 for(const text of [
  'ACORDA: declarar les places desertes i adjudicar altres places a una entitat.',
  'RESUELVE: declarar les places desertes i concedir altres places.',
  'Les places desertes i les places adjudicades consten a l’annex.',
  'Les places desertes i els concerts adjudicats consten a l’annex.',
  'S’acorda que s’adjudica un servei i es declaren les altres places desertes.',
  'Acorda declarar algunes places desertes i la concessió de places restants a la Fundació.',
  'S’atorguen places a una entitat i les altres queden desertes.',
  'Se dispone la adjudicación de unas plazas y otras quedan desertes.',
  'Resolc: no adjudicar les places que resten desertes.',
 ]){
  const chunk={id:'p1',source_document_id:'pdf',content:text,eligible:true};
  assert.equal(concertNoAwardFromEvidence(title,[{id:'pdf'}],[chunk],[chunk]),null);
 }
});

test('award combined with a financial change requires per-line review',async()=>{
 const {hasMixedConcertFinancialActs}=await import('../lib/concerts/no-award');
 assert.equal(hasMixedConcertFinancialActs('RESOLC: 1. Assignar places a l’entitat. 2. Reduir les places de l’altra entitat.'),true);
 assert.equal(hasMixedConcertFinancialActs('Antecedents: 2. Reduir les places anteriors. RESOLC: 1. Assignar places a l’entitat.'),false);
 assert.equal(hasMixedConcertFinancialActs('RESOLC: 1. Assignar places a l’entitat. 2. Denegar la resta.'),false);
 assert.equal(hasMixedConcertFinancialActs('RESOLC: 1. No modificar les places. 2. Assignar les places.'),false);
 assert.equal(hasMixedConcertFinancialActs('RESOLC: 1. Assignar places a l’entitat.\n## Annex\n2. Modificar una fila de mostra.'),false);
});

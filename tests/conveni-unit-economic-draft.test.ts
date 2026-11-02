import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnitEconomicDraft,unitEconomicDraftRpcArgs,UNIT_ECONOMIC_CONFIRMATIONS} from '../lib/convenis/unit-economic-draft';

const ids=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
function sample() {
 return {action:'prepare-unit-economic-draft',jobId:ids[0],unitId:ids[1],eventId:ids[2],previousDraftId:null,parentReviewId:null,
  sourceHash:'a'.repeat(32),proposalHash:'b'.repeat(64),analysisHash:'c'.repeat(64),
  documentRevisions:{[ids[3]]:`${'d'.repeat(64)}:`,[ids[4]]:`${'e'.repeat(64)}:${ids[5]}`},
  serviceCode:'1',amountLiteral:'1.000,00',monetaryCitation:{document_id:ids[3],page:1,quote:'Aportació prevista de 1.000,00 euros'},
  identityCitation:{document_id:ids[4],page:2,quote:'Entitat destinatària identificada'},
  rolePeriodCitation:{document_id:ids[4],page:3,quote:'Vigència per al període indicat'},
  confirmations:Object.fromEntries(UNIT_ECONOMIC_CONFIRMATIONS.map(k=>[k,true])),note:'Justificació de la revisió'};
}
test('prepares exact private RPC arguments without inferring documentary attribution',()=>{
 const parsed=parseUnitEconomicDraft({...sample(),ignored:'value'});
 assert.equal(parsed.amountCents,100000);
 assert.equal('ignored' in parsed,false);
 const args=unitEconomicDraftRpcArgs(ids[7],parsed);
 assert.equal(args.p_record,ids[7]);assert.equal(args.p_monetary.quote,'Aportació prevista de 1.000,00 euros');
 assert.deepEqual(Object.keys(args).sort(),['p_record','p_job','p_unit','p_event','p_previous','p_parent_review','p_source_hash','p_proposal_hash','p_analysis_hash','p_revisions','p_service','p_amount_cents','p_amount_literal','p_monetary','p_identity','p_role_period','p_confirmations','p_reason'].sort());
 assert.throws(()=>unitEconomicDraftRpcArgs('no',parsed));
});
test('rejects ambiguous, inconsistent, negative, or partial amounts',()=>{
 for(const amountLiteral of ['1.234','-100,00','12a','1,2']) assert.throws(()=>parseUnitEconomicDraft({...sample(),amountLiteral}));
 assert.throws(()=>parseUnitEconomicDraft({...sample(),amountCents:2}));
 assert.throws(()=>parseUnitEconomicDraft({...sample(),amountLiteral:'100,00'}));
 assert.equal(parseUnitEconomicDraft({...sample(),amountLiteral:'0',monetaryCitation:{document_id:ids[3],page:1,quote:'Aportació pública de 0 euros'}}).amountCents,0);
});
test('requires independent evidence references and every explicit assertion',()=>{
 const b=sample();
 for(const k of UNIT_ECONOMIC_CONFIRMATIONS) assert.throws(()=>parseUnitEconomicDraft({...b,confirmations:{...b.confirmations,[k]:false}}));
 assert.throws(()=>parseUnitEconomicDraft({...b,identityCitation:{...b.identityCitation,document_id:ids[6]}}));
 assert.throws(()=>parseUnitEconomicDraft({...b,rolePeriodCitation:{...b.rolePeriodCitation,page:0}}));
 assert.throws(()=>parseUnitEconomicDraft({...b,rolePeriodCitation:{...b.rolePeriodCitation,quote:'x'.repeat(4001)}}));
 assert.throws(()=>parseUnitEconomicDraft({...b,documentRevisions:{[ids[3]]:'bad'}}));
 assert.throws(()=>parseUnitEconomicDraft({...b,eventId:'invalid'}));
 assert.throws(()=>parseUnitEconomicDraft({...b,previousDraftId:b.eventId}));
 assert.throws(()=>parseUnitEconomicDraft({...b,note:'breu'}));
});
test('a literal within a ceiling remains a human assertion, not proof of attribution',()=>{
 const b=sample();
 const draft=parseUnitEconomicDraft({...b,amountLiteral:'4.000,00',monetaryCitation:{document_id:ids[3],page:1,quote:'Despeses de gestió fins a un màxim de 4.000,00 euros'}});
 assert.equal(draft.amountCents,400000);
 assert.equal(draft.confirmations.not_shared_or_maximum,true);
 assert.equal('approved' in draft,false);
});

import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';

const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ca').replace(/\s+/g,' ').trim();
/** Conservative document-backed proposal; never records a decision or changes
 * classification. Historical/ambiguous sources remain under ordinary review. */
export function concertVacantAmendmentProposal(record:Pick<SourceRecord,'title'|'financingType'|'isHistorical'|'reviewDecision'|'analysis'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical||record.reviewDecision||record.analysis?.classification!=='insufficient_evidence'||record.analysis.reliability_status==='invalidated')return null;
 if(!/^esmena\s+de\s+la\s+resolucio\s+de\s+places\s+desertes\b/.test(normalize(record.title)))return null;
 const documents=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf'));
 if(documents.length!==1)return null;
 const doc=documents[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.extractionPartial!==false||!doc.revision||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial))return null;
 const markers=[...doc.extractedText.matchAll(/^\s*RESOLC\s*:?\s*$/gim)];
 if(markers.length!==1)return null;
 const body=normalize(doc.extractedText.slice(markers[0].index!+markers[0][0].length));
 if(!/^esmenar\b/.test(body)||/\b(?:assign\w*|adjudic\w*|atorg\w*|conced\w*|aprovar la provisio)\b/.test(body.replace(/\bno assignades\b/g,'')))return null;
 const denials=[...body.matchAll(/\bes denega la provisio de les (\d+) places\b/g)];
 const vacant=[...body.matchAll(/\bes declaren desertes (\d+) places\b[^.]{0,300}\bno assignades\b/g)];
 if(denials.length!==1||vacant.length!==1||denials[0][1]!==vacant[0][1]||Number(denials[0][1])<1)return null;
 const before=doc.extractedText.slice(0,markers[0].index),pages=[...before.matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)];
 if(!pages.length)return null;
 return {documentId:doc.id,page:Number(pages[pages.length-1][1]),places:Number(denials[0][1])};
}

/** Display-only, document-backed suggestions. A call or spending authorization
 * is not itself proof of a new award. Do not turn a title into a decision. */
export function concertDiscardProposal(record:Parameters<typeof concertVacantAmendmentProposal>[0]){
 const vacant=concertVacantAmendmentProposal(record);
 if(vacant)return {...vacant,reason:`La resolució esmena una declaració de places desertes: denega ${vacant.places} places i les declara no assignades. Aquest acte no acredita una adjudicació nova.`};
 if(record.financingType!=='concert'||record.isHistorical||record.reviewDecision||record.analysis?.classification!=='insufficient_evidence'||record.analysis.reliability_status==='invalidated')return null;
 const title=normalize(record.title);
 const call=/^resolucio\s+[^,]+,\s*de\s+[^,]+,\s*de\s+convocatoria\b/.test(title);
 const spending=/^resolucio\s+d['’]autoritzacio de la despesa\b/.test(title);
 if(!call&&!spending)return null;
 const documents=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf'));
 if(documents.length!==1)return null;
 const doc=documents[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.extractionPartial!==false||!doc.revision||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial))return null;
 const markers=[...doc.extractedText.matchAll(/^\s*RESOLC\s*:?\s*$/gim)];
 if(markers.length!==1)return null;
 const after=doc.extractedText.slice(markers[0].index!+markers[0][0].length);
 const annex=/^\s*(?:#{1,6}\s*)?annex\s+(?:\d+|[IVX]+)(?:\s*:.*)?\s*$/im.exec(after);
 if(!annex)return null;
 const body=normalize(after.slice(0,annex.index));
 // Block mixed acts with an affirmative award as a numbered operative clause.
 if(/(?:^|\s)(?:[—–-]\s*\d+\s+|\d+\s*[.)-]\s*|(?:primer|segon|tercer|quart|cinque)[.\- ]+)(?:s['’]\s*)?(?:assignar|assigna|assignen|adjudicar|adjudica|adjudiquen|atorgar|atorga|atorguen|concedir|concedeix|concedeixen|aprovar la provisio)\b/.test(body))return null;
 if(call&&(!/^[—–-]\s*1\s+obrir una convocatoria\b/.test(body)||!/termini per presentar les sol[·.]licituds/.test(body)))return null;
 if(spending&&(!/^primer\s*\.\s*-\s*autoritzar la despesa\b/.test(body)||!/\bplaces assignades\b/.test(body)))return null;
 const pages=[...doc.extractedText.slice(0,markers[0].index).matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)];
 if(!pages.length)return null;
 const reason=call?'El resolc obre una convocatòria perquè les entitats presentin sol·licituds; aquesta obertura no acredita per si sola una adjudicació nova.':'El resolc autoritza una despesa vinculada a places ja assignades; aquesta autorització no acredita per si sola una adjudicació nova.';
 return {documentId:doc.id,page:Number(pages[pages.length-1][1]),reason};
}

const titleMotives:ReadonlyArray<{kind:'proposal'|'amendment';test:(title:string,audit:Record<string,unknown>)=>boolean;reason:string}>=[
 {kind:'proposal',test:(title,audit)=>/^acord proposta\b/.test(title)||audit.rule==='proposal',
  reason:'El document és un acord de proposta del comitè de provisió, no un acte ferm: el registre el genera la resolució definitiva. Si la definitiva ja consta a la base, no cal cap registre nou; si no hi és, es poden registrar els serveis proposats com a provisionals.'},
 {kind:'amendment',test:(title,audit)=>/^resolucio d['’]esmena de la resolucio\b/.test(title)&&
  ((audit.concert_model_discard_review as {original_reasons?:unknown}|undefined)?.original_reasons as unknown[]|undefined??[]).includes('no_concert_award'),
  reason:'La resolució esmena dades d’una resolució anterior i no adjudica serveis nous: no genera cap registre nou. Contrasta quines dades corregeix (per exemple, l’expedient GECAT o el número de disposició) i actualitza-les a les línies de la resolució original.'},
];
/** Display-only motive for acts the client validates as discards (Sprint 1):
 * a document-backed proposal when the operative clause is unambiguous, else a
 * title-and-rule motive that still asks to contrast the PDF. Never decides. */
export function concertDiscardMotive(record:Parameters<typeof concertVacantAmendmentProposal>[0]):{documentId:string|null;page:number|null;reason:string}|null{
 const documented=concertDiscardProposal(record);
 if(documented)return documented;
 if(record.financingType!=='concert'||record.isHistorical||record.reviewDecision||record.analysis?.classification!=='insufficient_evidence'||record.analysis.reliability_status==='invalidated')return null;
 const title=normalize(record.title),audit=record.analysis.rule_audit??{};
 const motive=titleMotives.find(item=>item.test(title,audit));
 if(!motive)return null;
 const documents=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf')&&doc.archived===true);
 return {documentId:documents.length===1?documents[0].id:null,page:documents.length===1?1:null,reason:motive.reason};
}

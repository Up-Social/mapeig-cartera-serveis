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

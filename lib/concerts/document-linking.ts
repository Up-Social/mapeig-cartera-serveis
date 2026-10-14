import type {ConcertPublication,ConcertLinkCandidate} from './record-linking';
import {concertActKind,concertResolutionNumbers,concertTerritory,publicationDate} from './record-linking';
import {isEligibleEvidence} from '../evidence-eligibility';
export type ConcertLinkDocument={id:string;source_record_id:string;status:string;mime_type:string|null;extraction_partial:boolean|null;extraction_method:string|null;quality_flags:string[]|null;storage_path:string|null;storage_sha256:string|null;extracted_text:string|null};
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,' ').replace(/\s+/g,' ').trim();
const months=['gener','febrer','marc','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];
const iso=(y:string,m:string,d:string)=>{const s=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;return !Number.isNaN(Date.parse(s))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s?s:null;};
/** Only the signature column, never publication, verification expiry or copy date. */
export function concertSignatureDates(text:string):string[]{
 const dates=new Set<string>();
 for(const match of text.matchAll(/^([ \t]*)Doc\.original signat per:([\s\S]{0,500})/gmi)){
  const column=match[1].length,block=match[2].split(/Data creaci[oó]/i)[0];
  for(const line of block.split('\n')){const m=line.match(/^([ \t]*)(\d{1,2})\/(\d{1,2})\/(20\d{2})(?:\s|$)/);if(m&&Math.abs(m[1].length-column)<=4){const date=iso(m[4],m[3],m[2]);if(date)dates.add(date);}}
 }
 return [...dates];
}
const eligible=(d:ConcertLinkDocument)=>d.status==='fetched'&&d.mime_type?.includes('pdf')&&!d.extraction_partial&&!!d.storage_path&&!!d.storage_sha256&&!!d.extracted_text&&isEligibleEvidence({content:d.extracted_text,extractionMethod:d.extraction_method,qualityFlags:d.quality_flags});
const words=(s:string)=>new Set(norm(s).match(/[a-z0-9]+/g)?.filter(w=>w.length>=4&&!['resolucio','serveis','socials','provisio','xarxa','publica','departament','catalunya','generalitat'].includes(w))??[]);
function compatibleTitle(a:string,b:string){
 const x=words(a),y=words(b),shared=[...x].filter(w=>y.has(w));
 // A date is insufficient: require the distinctive object, including programme/territory.
 if(x.size<6||shared.length/x.size<0.9)return false;
 const programmes=(s:string)=>norm(s).match(/programa\s+(\d+)/)?.[1];
 if(programmes(a)&&programmes(b)&&programmes(a)!==programmes(b))return false;
 const ta=concertTerritory(a),tb=concertTerritory(b);return !(ta&&tb&&ta!==tb);
}
/** Archived PDF references create publication candidates, never line identities or balances. */
export function proposeDocumentRecordLinks(rows:ConcertPublication[],documents:ConcertLinkDocument[]):ConcertLinkCandidate[]{
 const result:ConcertLinkCandidate[]=[];
 const docs=new Map(rows.map(r=>[r.id,documents.filter(d=>d.source_record_id===r.id&&eligible(d))]));
 for(const later of rows){
  const kind=concertActKind(later);if(!kind)continue;
  for(const d of docs.get(later.id)??[]){
   // Recitals identify previous acts; legal foundations and annex columns are not original references.
   const opening=d.extracted_text!.split(/Fonaments de dret/i)[0].slice(0,20000);
   const normalized=norm(opening);
   for(const earlier of rows){
    if(earlier.id===later.id||!publicationDate(earlier)||!publicationDate(later)||publicationDate(earlier)>=publicationDate(later))continue;
    const laterTerritory=concertTerritory(opening);
    const priorDocs=(docs.get(earlier.id)??[]).filter(p=>{
     const earlierTerritory=concertTerritory(p.extracted_text!.split(/Fets|Antecedents|Fonaments de dret/i)[0].slice(0,2500));
     return !(laterTerritory&&earlierTerritory&&laterTerritory!==earlierTerritory);
    });if(!priorDocs.length)continue;
    const number=concertResolutionNumbers(earlier.title)[0];
    // The cited object must also match; a shared call or legal resolution is not an agreement.
    let reference:string|null=null;
    if(number&&Number(number.split('/').at(-1))>=2024){
     const match=opening.match(new RegExp(`(?:esmen\\w*|rectific\\w*|modific\\w*|prorrogar|convalid\\w*|contra)[^.!?]{0,180}Resoluci[oó]\\s+${number.replaceAll('/','\\s*/\\s*')}`,'i'));
     if(match&&compatibleTitle(earlier.title,later.title)&&!/convocat[oò]ria/i.test(earlier.title))reference=match[0];
    }
    if(!reference){
     const signatures=new Set(priorDocs.flatMap(p=>concertSignatureDates(p.extracted_text!)));
     for(const match of normalized.matchAll(/(?:en data\s+|resolucio(?:\s+del\s+conseller)?\s+(?:de\s+data\s+|de\s+|d\s+))(\d{1,2})\s+(?:de\s+|d\s+)([a-z]+)\s+de\s+(20\d{2})/g)){
      const month=months.indexOf(match[2])+1,date=month?iso(match[3],String(month),match[1]):null;
      const tail=normalized.slice(match.index,match.index+650);
      if(date&&date>='2024-01-01'&&signatures.has(date)&&/resolucio/.test(tail)&&compatibleTitle(earlier.title,tail.split(/\s+[1-9]\.\s/)[0])){reference=`Referència de data ${date}: ${match[0]}`;break;}
     }
    }
    if(reference)result.push({laterRecordId:later.id,earlierRecordId:earlier.id,kind,method:'explicit_resolution',evidence:`PDF arxivat ${d.id} (SHA ${d.storage_sha256}): ${reference}. Títol/objecte contrastat amb el document anterior (${priorDocs.map(p=>p.id).join(', ')}); data de signatura separada de publicació. Proposta documental: cal validar RESES, NIF, línia i període; no confirma imports.`});
   }
  }
 }
 return [...new Map(result.map(r=>[`${r.laterRecordId}:${r.earlierRecordId}`,r])).values()];
}

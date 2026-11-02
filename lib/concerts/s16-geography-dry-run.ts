import {createHash} from 'node:crypto';
import reference from './data/municipalities-idescat.json';

export const S16_HTML_SHA='dac5ccb528c9be7620699a8bb9f5038756550481cd64054675acc7c63a92c259';
export const S16_DOCUMENT_SHA='9f7282744ad4adf90cebc7c0cc6954471e961d98f8d0f68481160bf63c4ff497';
export const S16_SOURCE_URL='https://tramits.gencat.cat/ca/tramits/tramits-temes/provisio_serveis_consorci_serveis_socials_barcelona?category=760fa1c0-a82c-11e3-a972-000c29052e2c&moda=2';
export const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
// Deliberately narrow: this is a pinned, manually reviewed HTML layout, not a
// general HTML parser. Changed or ambiguous layouts must fail closed.
export function extractS16Source(bytes:Uint8Array){
 const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const headings=["Servei d'Equip de Valoració de Maltractaments Infantils (EVAMI)",'Servei social de diagnòstic d’Equip Tècnic de Centre d’Acolliment (ETCA)'];
 const start=html.indexOf('La provisió és pels següents serveis:');
 if(start<0||html.indexOf('La provisió és pels següents serveis:',start+1)>=0||!html.includes('DOGC núm. 9409, de 09.05.2025'))throw Error('SOURCE_SCOPE_UNVERIFIED');
 const end=html.indexOf('</ol>',start);if(end<0)throw Error('SOURCE_LAYOUT_CHANGED');
 const plain=(s:string)=>normalize(s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"'));
 const content=plain(html.slice(start,end));
 const first=content.indexOf(headings[0]),second=content.indexOf(headings[1]);
 if(first<0||second<=first||content.indexOf(headings[0],first+1)>=0||content.indexOf(headings[1],second+1)>=0)throw Error('SOURCE_SERVICES_AMBIGUOUS');
 const evami=content.slice(first,second).trim(),etca=content.slice(second).trim();
 if(!evami.includes("Ubicació: dependències de l'entitat proveïdora a Barcelona.")||!etca.includes('Ubicació: dependències del Centre d’acolliment Els Llimoners a Barcelona'))throw Error('SOURCE_LOCATION_CHANGED');
 // Use only faithful excerpts from the captured HTML: no synthetic conversion
 // of public-coverage area into the location of the provider.
 const sourceText='DOGC núm. 9409, de 09.05.2025\n'+content;
 const cities=reference.rows.filter(row=>row[1]==='Barcelona');
 if(cities.length!==1||cities[0][2]!=='Barcelonès'||cities[0][3]!=='Barcelona')throw Error('REFERENCE_AMBIGUOUS');
 return {sourceText,quotes:{EVAMI:evami,ETCA:etca},reference:{municipalityCode:cities[0][0],municipality:cities[0][1],county:cities[0][2],province:cities[0][3],sourceUrl:reference.sourceUrl,sha256:reference.sha256}};
}
export function compareS16Sources(local:Uint8Array,live:Uint8Array){
 if(sha(local)!==S16_HTML_SHA)throw Error('LOCAL_SNAPSHOT_HASH_CHANGED');
 const saved=extractS16Source(local),current=extractS16Source(live);
 if(saved.quotes.EVAMI!==current.quotes.EVAMI||saved.quotes.ETCA!==current.quotes.ETCA)throw Error('SOURCE_CONTENT_CHANGED');
 return current;
}

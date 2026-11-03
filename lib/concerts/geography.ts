import reference from './data/municipalities-idescat.json';
import type {ConcertChangeLine} from './change-extraction';

export type ConcertGeography={municipality:string;county:string|null;province:string|null;page:number;
 rowQuote:string;headerQuote:string;rawLine:string;columnStart:number;columnEnd:number;
 reference:{municipalityCode:string;municipality:string;county:string;province:string;sourceUrl:string;sha256:string}|null};
const normalize=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('ca');

/** Read one literal, single-line Municipi cell. No registry/address/footer inference.
 * Administrative hierarchy comes from a pinned official correspondence table,
 * separately from the historical document. Unknown/ambiguous layouts stay pending. */
export function extractConcertChangeGeography(text:string,row:ConcertChangeLine):ConcertGeography|null{
 const pages=text.split(/(?=^## Pàgina \d+\s*$)/m);
 const matchingPages=pages.filter(value=>Number(value.match(/^## Pàgina (\d+)/)?.[1])===row.page);
 if(matchingPages.length!==1)return null;
 const page=matchingPages[0];
 const lines=page.split('\n');
 const matches=lines.map((rawLine,index)=>({rawLine,index})).filter(({rawLine})=>normalize(rawLine)===normalize(row.quote));
 if(matches.length!==1)return null;
 const {rawLine,index}=matches[0];
 if([...rawLine.matchAll(/\b[A-Z]\d{7}[0-9A-Z]\b/g)].length!==1||[...rawLine.matchAll(/\bS\d{5}\b/g)].length!==1)return null;
 const headers=lines.slice(0,index).filter(line=>/\bMunicipi\b/.test(line)&&/\bIVA\b/.test(line));
 if(headers.length!==1)return null;
 const headerQuote=headers[0],columnStart=headerQuote.indexOf('Municipi'),columnEnd=headerQuote.indexOf('IVA',columnStart);
 if(/[\t\uD800-\uDFFF]/.test(headerQuote+rawLine)||columnStart<0||columnEnd<=columnStart||columnEnd-columnStart>100)return null;
 if((rawLine[columnStart-1]&&!/\s/.test(rawLine[columnStart-1]))||(rawLine[columnEnd]&&!/\s/.test(rawLine[columnEnd])))return null;
 const municipality=rawLine.slice(columnStart,columnEnd).trim();
 if(!/^[\p{L}][\p{L}\p{M}\s.'’·,-]*$/u.test(municipality))return null;
 // A wrapped cell is intentionally unsupported, rather than silently truncated.
 if([lines[index-1],lines[index+1]].some(line=>line?.slice(columnStart,columnEnd).trim()&&!/\b[A-Z]\d{7}[0-9A-Z]\b/.test(line)))return null;
 const places=reference.rows.filter(place=>normalize(place[1])===normalize(municipality));
 const literal={municipality,page:row.page,rowQuote:row.quote,headerQuote,rawLine,columnStart,columnEnd};
 if(places.length!==1)return {...literal,county:null,province:null,reference:null};
 const [municipalityCode,officialMunicipality,county,province]=places[0];
 return {...literal,county,province,
  reference:{municipalityCode,municipality:officialMunicipality,county,province,sourceUrl:reference.sourceUrl,sha256:reference.sha256}};
}

export type MunicipalityReference={municipalityCode:string;municipality:string;county:string;province:string;sourceUrl:string};
/** County and province of a municipality already recorded on a line, from the
 * pinned Idescat correspondence. An unknown or ambiguous name stays pending. */
export function municipalityReference(name:string|null|undefined):MunicipalityReference|null{
 if(!name?.trim())return null;
 const places=reference.rows.filter(place=>normalize(place[1])===normalize(name));
 if(places.length!==1)return null;
 const [municipalityCode,municipality,county,province]=places[0];
 return {municipalityCode,municipality,county,province,sourceUrl:reference.sourceUrl};
}

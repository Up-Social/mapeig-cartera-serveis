import {concertNoAwardTitle,hasDefinitiveConcertAward} from './no-award';

/** Read only literal numbered headings from the proposal's assigned-services annex.
 * These observations are not reviewable units, decisions or economic evidence. */
export function provisionalServiceHeadings(title:string,text:string):{heading:string;page:number|null}[]{
 if(concertNoAwardTitle(title,text)?.kind!=='proposal'||hasDefinitiveConcertAward(text))return [];
 const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const titlePrefix=normalized(title).slice(0,80).trim();
 if(titlePrefix.length<40||!normalized(text.slice(0,5000)).includes(titlePrefix))return [];
 const proposals=[...text.matchAll(/^[\t ]*PROPOSA[\t ]*$/gim)];
 const annexes=[...text.matchAll(/^[\t ]*ANNEX[\t ]+1[\t ]*\.[\t ]*SERVEIS[\t ]+ASSIGNATS[\t ]*$/gim)];
 const ends=[...text.matchAll(/^[\t ]*ANNEX[\t ]+2\b/gim)];
 if(proposals.length!==1||annexes.length!==1||ends.length!==1)return [];
 const marker=annexes[0];
 if((proposals[0].index??-1)>=(marker.index??-1)||(ends[0].index??-1)<=(marker.index??-1))return [];
 const rest=text.slice(marker.index+marker[0].length);
 const section=rest.slice(0,ends[0].index-(marker.index+marker[0].length));
 const rows=[...section.matchAll(/^\s*(\d{1,2})\.-\s+([^\n]{10,400}\ben\s+règim\s+de\s+(?:concert\s+social|gestió\s+delegada))\s*$/gim)];
 // Do not present a partial list when another numbered heading is unreadable
 // or outside the recognized layout. Its service must remain under review.
 const numbered=[...section.matchAll(/^[\t ]*\d+(?:[\t ]*\.[\t ]*-|[\t ]*[.)])(?=\s|$)/gm)];
 if(!rows.length||rows.length!==numbered.length||rows.length>20||new Set(rows.map(row=>row[1])).size!==rows.length)return [];
 return rows.map(row=>{
  const preceding=text.slice(0,marker.index+marker[0].length+(row.index??0));
  const pages=[...preceding.matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)];
  return {heading:row[2].replace(/\s+/g,' ').trim(),page:pages.length?Number(pages[pages.length-1][1]):null};
 });
}

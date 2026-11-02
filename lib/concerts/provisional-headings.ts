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

/** Bounded proposal annex totals, explicitly labelled with and without VAT.
 * These are source observations, never awarded amounts or approved financing. */
export function provisionalServiceAmounts(title:string,text:string):{heading:string;page:number;netCents:number;grossCents:number}[]|null{
 const headings=provisionalServiceHeadings(title,text);
 if(!headings.length)return null;
 const end=text.search(/^[\t ]*ANNEX[\t ]+2\b/gim);
 const rows:Array<{heading:string;page:number;netCents:number;grossCents:number}>=[];
 for(let i=0;i<headings.length;i++){
  const heading=headings[i],start=text.indexOf(heading.heading),next=i+1<headings.length?text.indexOf(headings[i+1].heading):end;
  if(start<0||next<=start||!heading.page||text.indexOf(heading.heading,start+heading.heading.length)!==-1)return null;
  const section=text.slice(start,next).split(/^##\s+Pàgina\s+\d+\s*$/m)[0];
  if(!/sense\s+IVA/i.test(section)||!/amb\s+IVA\s*\(\s*10\s*%\s*\)/i.test(section))return null;
  const totals=[...section.matchAll(/^[\t ]*Import\s+total[\t ]+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s+euros[\t ]+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s+euros[\t ]*$/gim)];
  if(totals.length!==1)return null;
  const cents=(s:string)=>{const [whole,decimal]=s.replaceAll('.','').split(',');return Number(whole)*100+Number(decimal);};
  const netCents=cents(totals[0][1]),grossCents=cents(totals[0][2]);
  if(!Number.isSafeInteger(netCents)||!Number.isSafeInteger(grossCents)||netCents<0||netCents>Math.floor(Number.MAX_SAFE_INTEGER/11)||Math.round(netCents*11/10)!==grossCents)return null;
  rows.push({heading:heading.heading,page:heading.page,netCents,grossCents});
 }
 if(!Number.isSafeInteger(rows.reduce((sum,row)=>sum+row.grossCents,0)))return null;
 return rows;
}

/** Correlate a proposal heading with a single application and assessment via
 * their printed FUE number. These are observations, not award decisions. */
export function provisionalServiceIdentifiers(title:string,text:string){
 const headings=provisionalServiceHeadings(title,text);
 if(!headings.length)return [];
 const proposal=text.search(/^[\t ]*PROPOSA[\t ]*$/im);
 if(proposal<0)return [];
 const before=text.slice(0,proposal);
 const blocks=[...before.matchAll(/\S[\s\S]*?(?=\n[\t ]*\n|$)/g)].map(match=>({raw:match[0],text:match[0].replace(/\s+/g,' '),index:match.index!}));
 const page=(index:number)=>{const markers=[...text.slice(0,index).matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)];return markers.length?Number(markers[markers.length-1][1]):null;};
 const fue=(block:string)=>[...block.matchAll(/\bFUE\s*-\s*(20\d{2})\s*-\s*(\d{6,12})\b/gi)].map(match=>`${match[1]}-${match[2]}`);
 const observations=headings.flatMap(row=>{
  const acronyms=[...row.heading.matchAll(/\(([A-Z]{3,8})\)/g)].map(match=>match[1]);
  if(acronyms.length!==1)return [];
  const acronym=acronyms[0],includesService=(s:string)=>new RegExp(`\\b${acronym}\\b`).test(s);
  const applications=blocks.filter(block=>/\bsol·licitud\b/i.test(block.text)&&includesService(block.text)&&/\bCIF\s*:/i.test(block.text));
  const assessments=blocks.filter(block=>/\bCodi\s+RESES\s*:/i.test(block.text)&&includesService(block.text));
  if(applications.length!==1||assessments.length!==1)return [];
  const application=applications[0],assessment=assessments[0];
  const appFue=fue(application.text),assessmentFue=fue(assessment.text);
  const nifs=[...application.text.matchAll(/\bCIF\s*:\s*([A-Z]\d{7}[A-Z0-9])\b/gi)];
  const reses=[...assessment.text.matchAll(/\bCodi\s+RESES\s*:\s*(S\d{5})\b/gi)];
  const applicationPage=page(application.index+application.raw.search(/\bCIF\s*:/i)),assessmentPage=page(assessment.index+assessment.raw.search(/\bCodi\s+RESES\s*:/i));
  if(appFue.length!==1||assessmentFue.length!==1||appFue[0]!==assessmentFue[0]||nifs.length!==1||reses.length!==1||!applicationPage||!assessmentPage)return [];
  return [{heading:row.heading,nif:nifs[0][1].toUpperCase(),reses:reses[0][1].toUpperCase(),applicationPage,assessmentPage,reference:appFue[0]}];
 });
 return observations.filter(row=>observations.filter(other=>other.reference===row.reference).length===1).map(row=>({heading:row.heading,nif:row.nif,reses:row.reses,applicationPage:row.applicationPage,assessmentPage:row.assessmentPage}));
}

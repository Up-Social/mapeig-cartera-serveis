/** Conservative observations from signed economic annex rows. Never a financial decision. */
/** The printed name is a candidate, not a verified identity of a centre. */
export type ConcertCentreObservation={kind:'printed_service_name_candidate';centre:string;blockQuote:string;headerQuote:string;columnStart:number;columnEnd:number};
export type ConcertChangeLine={page:number;row:number;nif:string;resesCode:string;observedServiceCode:string;
 amountCents:number;quantityDelta:number;quote:string;centreObservation?:ConcertCentreObservation;};

/** Optional documentary observation, separate from the existing financial anchor.
 * Only the named column of one isolated, page-local row block is supported. */
function centreObservation(lines:string[],rowIndex:number):ConcertCentreObservation|undefined{
 const headers=lines.slice(0,rowIndex).map((line,index)=>({line,index})).filter(({line})=>/\bNom servei\b/.test(line));
 if(headers.length!==1)return;
 const {line:headerQuote,index:headerIndex}=headers[0];
 const annexHeadings=lines.map((line,index)=>/^\s*Annex\s*$/i.test(line)?index:-1).filter(index=>index>=0);
 if(annexHeadings.length!==1||annexHeadings[0]>=headerIndex)return;
 // Reject non-BMP text: JS offsets then equal Unicode code-point offsets used
 // by prospective SQL validation (both are zero-based in this observation).
 if(/[\t\uD800-\uDFFF]/.test(headerQuote)||[...headerQuote.matchAll(/\bNom servei\b/g)].length!==1)return;
 const columnStart=headerQuote.indexOf('Nom servei');
 const endings=[...headerQuote.matchAll(/\b(?:Partida(?: pressupostària)?|pressupostària)\b/g)].filter(m=>m.index!>columnStart);
 const columnEnd=endings[0]?.index;
 const registry=headerQuote.indexOf('Codi S'),nif=headerQuote.indexOf('NIF entitat');
 if(endings.length!==1||columnEnd===undefined||nif<0||registry<=nif||columnStart<=registry||columnEnd-columnStart<10||columnEnd-columnStart>100)return;
 let start=headerIndex+1;
 for(let i=start;i<rowIndex;i++){
  // A blank line, or the explicitly labelled departmental subtotal immediately
  // below the header, delimits a block; a neighbouring identity never does.
  if(!lines[i].trim())start=i+1;
  else if(i===headerIndex+1&&/^\s*BE\d+\s+/.test(lines[i])&&!lines[i].slice(columnStart,columnEnd).trim())start=i+1;
 }
 const block=lines.slice(start,rowIndex+1);
 if(block.length<1||block.length>8||block.some(line=>/[\t\uD800-\uDFFF]/.test(line)||/## Pàgina|\b(?:Annex|Total|general)\b/i.test(line)))return;
 if(block.slice(0,-1).some(line=>/\b(?:[A-Z]\d{7}[0-9A-Z]|S\d{5})\b/.test(line)))return;
 if([...lines[rowIndex].matchAll(/\b[A-Z]\d{7}[0-9A-Z]\b/g)].length!==1||[...lines[rowIndex].matchAll(/\bS\d{5}\b/g)].length!==1)return;
 // Trailing centre text may belong to the current row; this reader must not
 // return a truncated name or lend that continuation to the next row.
 const next=lines[rowIndex+1];
 if(next?.trim()&&!/^\s*Total\b/i.test(next)&&next.slice(columnStart,columnEnd).trim()&&!/\b[A-Z]\d{7}[0-9A-Z]\b/.test(next))return;
 const segments=block.map(line=>line.slice(columnStart,columnEnd).trim()).filter(Boolean);
 if(!segments.length||segments.some(value=>!/[\p{L}]/u.test(value)||/[€\t]|\b(?:S\d{5}|[A-Z]\d{7}[0-9A-Z])\b/.test(value)))return;
 // Printed columns need whitespace on either side: do not cut words from an
 // adjacent field when a different layout shifts the actual cell boundaries.
 if(block.some(line=>(line[columnStart]&&!/\s/.test(line[columnStart])&&line[columnStart-1]&&!/\s/.test(line[columnStart-1]))||(line[columnEnd]&&!/\s/.test(line[columnEnd])&&line[columnEnd-1]&&!/\s/.test(line[columnEnd-1]))))return;
 const centre=segments.join(' ').replace(/\s+/g,' ');
 if(centre.length<3||centre.length>300)return;
 return {kind:'printed_service_name_candidate',centre,blockQuote:block.join('\n'),headerQuote,columnStart,columnEnd};
}
export function extractConcertChangeRows(text:string):ConcertChangeLine[]{
 let inAnnex=false,centreAnnexSeen=false;
 const pages=text.split(/(?=^## Pàgina \d+\s*$)/m),rows:ConcertChangeLine[]=[];
 for(const [index,page] of pages.entries()){
  // Continuation pages can start with the tail of an earlier name even when
  // the column header is repeated. Optional names are deliberately limited to
  // the first page bearing a standalone annex heading.
  const centrePage=!centreAnnexSeen&&/^\s*Annex\s*$/im.test(page);
  if(centrePage)centreAnnexSeen=true;
  // Avoid narrative amounts, DA copies and annual reference tariffs. A named
  // cost/assignment column and a complete identity row are both required.
  if(/\bAnnex\b/i.test(page))inAnnex=true;
  if(!inAnnex||!/(cost|import)/i.test(page)||!/(places|assignar)/i.test(page))continue;
  const lines=page.split('\n');
  for(const [lineIndex,line] of lines.entries()){
   const nif=line.match(/\b[A-Z]\d{7}[0-9A-Z]\b/)?.[0],reses=line.match(/\bS\d{5}\b/)?.[0],code=line.match(/\b\d(?:\.\d+){2,6}\b/)?.[0];
   const tail=line.match(/\s(-?\d+)\s+(-?[\d.]+,\d{2})\s*€(?:\s+(-?[\d.]+,\d{2})\s*€)?\s*$/);
   if(!nif||!reses||!code||!tail)continue;
   const printed=tail[3]??tail[2],sign=printed.startsWith('-')?-1:1;
   const [whole,fraction]=printed.replace('-','').replaceAll('.','').split(',');
   const cents=sign*(Number(whole)*100+Number(fraction)),quantity=Number(tail[1]);
   if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(quantity)||quantity===0||Math.sign(cents)!==Math.sign(quantity))continue;
   const centre=centrePage?centreObservation(lines,lineIndex):undefined;
   rows.push({page:Number(page.match(/^## Pàgina (\d+)/)?.[1])||index+1,row:rows.length+1,nif,resesCode:reses,observedServiceCode:code,amountCents:cents,quantityDelta:quantity,quote:line.trim().replace(/\s+/g,' '),...(centre?{centreObservation:centre}:{})});
  }
 }
 return rows;
}

/** Generic titles cannot turn a reduction in the operative clause into an award. */
export function operativeConcertChange(text:string):'modification'|'termination'|null{
 const marker=/^\s*resolc\s*:?\s*$/im.exec(text);if(!marker)return null;
 const clause=text.slice(marker.index+marker[0].length).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
 if(/^(?:1[.)]\s*)?(?:reduir|minorar|modificar|ampliar)\b/i.test(clause))return 'modification';
 if(/^(?:1[.)]\s*)?(?:cessar|extingir|acceptar el cessament)\b/i.test(clause))return 'termination';
 return null;
}

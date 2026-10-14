/** Conservative observations from signed economic annex rows. Never a financial decision. */
export type ConcertChangeLine={page:number;row:number;nif:string;resesCode:string;observedServiceCode:string;
 amountCents:number;quantityDelta:number;quote:string;};
export function extractConcertChangeRows(text:string):ConcertChangeLine[]{
 let inAnnex=false;
 const pages=text.split(/(?=^## Pàgina \d+\s*$)/m),rows:ConcertChangeLine[]=[];
 for(const [index,page] of pages.entries()){
  // Avoid narrative amounts, DA copies and annual reference tariffs. A named
  // cost/assignment column and a complete identity row are both required.
  if(/\bAnnex\b/i.test(page))inAnnex=true;
  if(!inAnnex||!/(cost|import)/i.test(page)||!/(places|assignar)/i.test(page))continue;
  for(const line of page.split('\n')){
   const nif=line.match(/\b[A-Z]\d{7}[0-9A-Z]\b/)?.[0],reses=line.match(/\bS\d{5}\b/)?.[0],code=line.match(/\b\d(?:\.\d+){2,6}\b/)?.[0];
   const tail=line.match(/\s(-?\d+)\s+(-?[\d.]+,\d{2})\s*€(?:\s+(-?[\d.]+,\d{2})\s*€)?\s*$/);
   if(!nif||!reses||!code||!tail)continue;
   const printed=tail[3]??tail[2],sign=printed.startsWith('-')?-1:1;
   const [whole,fraction]=printed.replace('-','').replaceAll('.','').split(',');
   const cents=sign*(Number(whole)*100+Number(fraction)),quantity=Number(tail[1]);
   if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(quantity)||quantity===0||Math.sign(cents)!==Math.sign(quantity))continue;
   rows.push({page:Number(page.match(/^## Pàgina (\d+)/)?.[1])||index+1,row:rows.length+1,nif,resesCode:reses,observedServiceCode:code,amountCents:cents,quantityDelta:quantity,quote:line.trim().replace(/\s+/g,' ')});
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

export type OriginalSignatureEvidence = {
 date: string;
 page: number | null;
 quote: string;
 copyDate: string | null;
};
const iso = (day:string,month:string,year:string) => {
 const value=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
 const parsed=new Date(`${value}T00:00:00Z`);
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:null;
};
/** Literal printed dates, not cryptographic verification or an award date.
 * Layout columns prevent CSV expiry/copy dates from becoming signer dates.
 * Page is null when extraction has no explicit page boundary. */
export function originalSignatureEvidence(text:string):OriginalSignatureEvidence[]{
 const result:OriginalSignatureEvidence[]=[];
 const pages=text.split(/\f|(?=^## Pàgina \d+\s*$)/m);
 let physicalPage=1;
 for(const part of pages){
  const explicit=part.match(/^## Pàgina (\d+)\s*$/m);
  const page=explicit?Number(explicit[1]):text.includes('\f')?physicalPage:null;
  physicalPage++;
  for(const match of part.matchAll(/^([ \t]*)Doc\.\s*original signat per:([^\n]*(?:\n(?![ \t]*Doc\.\s*original signat per:)[^\n]*){0,8})/gmi)){
   const column=match[1].length;
   const original=match[2].split(/Data creaci[oó]\s+c[oò]pia/i)[0];
   const dates=[...original.matchAll(/^([ \t]*)(\d{1,2})\/(\d{1,2})\/(20\d{2})(?=\s|$)/gm)]
    .filter(item=>Math.abs(item[1].length-column)<=4)
    .map(item=>iso(item[2],item[3],item[4])).filter((date):date is string=>!!date);
   if(!dates.length)continue;
   const copyBlock=match[2].split(/Data creaci[oó]\s+c[oò]pia:/i)[1]?.split('\n').slice(0,3).join('\n');
   const copy=copyBlock?.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
   for(const date of new Set(dates))result.push({date,page,quote:match[0].trim(),copyDate:copy?iso(copy[1],copy[2],copy[3]):null});
  }
 }
 return result;
}
/** Contradictory original signer dates require review; repeated footers agree. */
export function unambiguousOriginalSignature(text:string):OriginalSignatureEvidence[]|null{
 const found=originalSignatureEvidence(text);
 return found.length&&new Set(found.map(item=>item.date)).size===1?found:null;
}

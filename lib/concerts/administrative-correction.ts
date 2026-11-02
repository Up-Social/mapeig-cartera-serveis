/** Read a narrowly structured amendment table as proposals, not financial
 * movements. A person must link and confirm the original unit separately. */
export type AdministrativeCorrection={page:number;resesCode:string;gecat:string;disposition:string;position:number;quote:string};
export function extractAdministrativeCorrections(text:string):{rows:AdministrativeCorrection[];unparsedRows:number;incompleteBoundary:boolean}{
 // The correction must begin the operative clause. Searching arbitrarily far
 // beyond RESOLC can mistake an incidental later reference for the action and
 // attribute unrelated administrative fields to a correction.
 const operative=/\bresolc\s*:\s*(?:1\s*[.)]\s*)?(?:esmenar|rectificar)\b/i.exec(text);
 if(!operative||operative.index===undefined)return {rows:[],unparsedRows:0,incompleteBoundary:false};
 const start=operative.index;
 const endMatch=/\n\s*2\s*[.)]\s*(?:notificar|publicar|comunicar)\b/i.exec(text.slice(start));
 if(!endMatch)return {rows:[],unparsedRows:0,incompleteBoundary:true};
 const priorPages=[...text.slice(0,start).matchAll(/^## Pàgina (\d+)\s*$/gm)];
 const prefix=priorPages.length?`## Pàgina ${priorPages.at(-1)![1]}\n`:'';
 const pages=(prefix+text.slice(start,start+endMatch.index)).split(/(?=^## Pàgina \d+\s*$)/m);
 const rows:AdministrativeCorrection[]=[];let unparsedRows=0;
 for(const pageText of pages){
  const page=Number(pageText.match(/^## Pàgina (\d+)/m)?.[1]);
  if(!page||!/(?:Expedient[\s\S]{0,160})?\bGECAT\b[\s\S]{0,100}\bDisposici[oó](?=\s|$)[\s\S]{0,60}\bPosici[oó](?=\s|$)/i.test(pageText))continue;
  const lines=pageText.split('\n');
  for(let index=0;index<lines.length;index++){
   const match=lines[index].match(/\bS\d{5}\b/);if(!match)continue;
   let end=index;
   while(end+1<lines.length&&end-index<6&&!/\bS\d{5}\b/.test(lines[end+1]))end++;
   const quote=lines.slice(index,end+1).join('\n').trim().replace(/\s+/g,' ');
   // A flattened PDF row can contain multiple registry codes or multiple
   // administrative field sets. Never attribute the first set by position
   // when the evidence does not uniquely identify the row.
   const identifiers=[...quote.matchAll(/\bS\d{5}\b/g)];
   const fieldSets=[...quote.matchAll(/\b(BE-20\d{2}-[A-Z]\d+)\s+(\d{10})\s+(\d+)\b/gi)];
   if(identifiers.length!==1||fieldSets.length!==1){unparsedRows++;continue;}
   const fields=fieldSets[0];
   const position=Number(fields[3]);
   if(!Number.isSafeInteger(position)||position<1){unparsedRows++;continue;}
   rows.push({page,resesCode:match[0],gecat:fields[1],disposition:fields[2],position,quote:quote.slice(0,(fields.index??0)+fields[0].length)});
  }
 }
 return {rows,unparsedRows,incompleteBoundary:false};
}

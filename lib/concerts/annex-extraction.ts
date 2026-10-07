/** Only rows matching every structural column are proposed. Never approve from extraction. */
export type ExtractedConcertLine={
 page:number;row:number;nif:string;serviceCode:string;resesCode:string;
 dispositionNumber:string;territory:string;effectiveStart:string;effectiveEnd:string;
 quantity:number;amountCents:number;quote:string;observedProviderName:string|null;
};

/** Names occupy a stable printed column in these two official annex layouts.
 * Collect wrapped lines above the data row, but never infer a legal identity
 * from a NIF or another publication. The value remains an observation. */
function printedColumn(lines:string[],start:number,end:number,from:number,to:number):string|null{
 const pieces=lines.slice(from,to+1).map(line=>line.slice(start,end).trim())
  .filter(part=>part&&!/^(nom entitat|nif entitat|tipologia de servei|GENERALITAT|cost anual)/i.test(part));
 const value=pieces.join(' ').replace(/\s+/g,' ').replace(/\s+a$/,'').replace(/\s+[A-Z]\d{2,7}$/,'').trim();
 return value.length>=3?value:null;
}

const rowPattern=/\b([A-Z]\d{7}[0-9A-Z])\s+(\d(?:\.\d+){2,5})\s+.+?\s+(S\d{5})\s+.+?\s+(\d{10})\s+\d+\s+(.+?)\s+\d+%\s+[\d.,]+\s*€\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+([\d.,]+)\s*€/u;
const isoDate=(value:string)=>{const [day,month,year]=value.split('/');return `${year}-${month}-${day}`;};
const cents=(value:string)=>Math.round(Number(value.replaceAll('.','').replace(',','.'))*100);

export function extractConcertAnnexRows(text:string):ExtractedConcertLine[]{
 const rows:ExtractedConcertLine[]=[];
 for(const [index,pageText] of text.split('\f').entries()){
  const lines=pageText.split('\n');let previousRow=-1;
  for(const [lineIndex,line] of lines.entries()){
   const match=line.match(rowPattern);
   if(!match)continue;
   const quantity=Number(match[8]),amountCents=cents(match[9]);
   if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(amountCents)||amountCents<0)continue;
   const observedProviderName=printedColumn(lines,36,60,Math.max(previousRow+1,lineIndex-7),lineIndex);
   rows.push({page:index+1,row:rows.length+1,nif:match[1],serviceCode:match[2],resesCode:match[3],
    dispositionNumber:match[4],territory:match[5].trim(),effectiveStart:isoDate(match[6]),effectiveEnd:isoDate(match[7]),
    quantity,amountCents,quote:line.trim().replace(/\s+/g,' '),observedProviderName});
   previousRow=lineIndex;
  }
 }
 return rows;
}

/** Program 317 repeats an entity/disposition budget on several service rows.
 * It is deliberately not interpreted as an individual amount. */
export function extractProgram317Rows(text:string){
 const rows:Array<{page:number;row:number;nif:string;resesCode:string;dispositionNumber:string;quote:string;observedProviderName:string|null;observedServiceName:string|null}>=[];
 for(const [index,pageText] of text.split('\f').entries()){
  const lines=pageText.split('\n');let previousRow=-1;
  for(const [lineIndex,line] of lines.entries()){
   const match=line.match(/\b([A-Z]\d{7}[0-9A-Z])\b.+?\b(\d{10})\b.+?\b(S\d{5})\b/);
   if(!match)continue;
   const from=Math.max(previousRow+1,lineIndex-6);
   rows.push({page:index+1,row:rows.length+1,nif:match[1],dispositionNumber:match[2],resesCode:match[3],
    quote:line.trim().replace(/\s+/g,' '),observedProviderName:printedColumn(lines,42,64,from,lineIndex),
    observedServiceName:printedColumn(lines,227,251,from,lineIndex)});
   previousRow=lineIndex;
  }
 }
 return rows;
}

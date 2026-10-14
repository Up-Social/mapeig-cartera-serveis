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

/** Observations from the economic annex, before any service or entity is approved. */
export type EconomicAnnexLine={
 annex:0|6|7;page:number;row:number;nif:string;observedProviderName:string|null;
 observedServiceCode:string|null;observedServiceName?:string|null;resesCode:string;municipality:string|null;
 quantity:number;amountCents:number;quote:string;
};

const printedMoney=/([\d.]+,\d{2})\s*€/gu;
const printedNif=/\b[A-Z]\d{7}[0-9A-Z]\b/u;
const printedReses=/\bS\d{5}\b/u;
const printedCode=/\b\d(?:\.\d+){2,6}(?:\.)?\b/u;
function annexPageParts(text:string){
 if(/^## Pàgina \d+/m.test(text))return text.split(/(?=^## Pàgina \d+\s*$)/m).filter(Boolean).map((value,index)=>({number:Number(value.match(/^## Pàgina (\d+)/)?.[1])||index+1,text:value}));
 return text.split('\f').map((value,index)=>({number:index+1,text:value}));
}
function observedName(lines:string[],from:number,to:number,start:number,end:number){
 const fragments=lines.slice(from,to+1).map(line=>line.slice(start,end).trim())
  .filter(value=>value&&value.length>1&&!/^(nom entitat|nif entitat|centre gestor|generalitat|fue|cost)/i.test(value));
 const name=fragments.join(' ').replace(/\s+/g,' ').trim();
 return name.length>=3?name:null;
}

/**
 * Two complete official provision annexes use different column widths. Their
 * monetary row is identified by RESES, a final euro amount and a place count.
 * Blank identity cells inherit only within the same annex, never across acts.
 */
export function extractEconomicAnnexRows(text:string):EconomicAnnexLine[]{
 const result:EconomicAnnexLine[]=[];
 let active:6|7|null=null,nif='',name:string|null=null,serviceCode:string|null=null;
 for(const page of annexPageParts(text)){
  const lines=page.text.split('\n');let previousRow=-1;
  for(let index=0;index<lines.length;index++){
   const line=lines[index];
   const heading=line.match(/^\s*ANNEX\s+([67])\s+IMPORTS\s+ECON[ÒO]MICS\s*$/i);
   if(heading){active=Number(heading[1]) as 6|7;nif='';name=null;serviceCode=null;previousRow=index;continue;}
   if(!active||!printedReses.test(line)||!/[\d.]+,\d{2}\s*€\s*$/.test(line))continue;
   const amounts=[...line.matchAll(printedMoney)].map(match=>Math.round(Number(match[1].replaceAll('.','').replace(',','.'))*100));
   if(amounts.length<(active===7?3:2))continue;
   const amountCents=amounts.at(-1)!;
   const quantityMatch=line.match(active===7
    ? /[\d.]+,\d{2}\s*€\s+(\d+)\s+[\d.]+,\d{2}\s*€\s+[\d.]+,\d{2}\s*€\s*$/
    : /[\d.]+,\d{2}\s*€\s+(\d+)\s+[\d.]+,\d{2}\s*€\s*$/);
   const quantity=Number(quantityMatch?.[1]);
   if(!Number.isSafeInteger(amountCents)||amountCents<0||!Number.isSafeInteger(quantity)||quantity<1)continue;
   const identity=line.match(printedNif);
   if(identity){
    nif=identity[0];
    const start=active===7?19:47,end=identity.index??line.length;
    name=observedName(lines,Math.max(previousRow+1,index-8),index,start,end)??name;
   }
   if(!nif)continue;
   const explicitCode=line.match(printedCode)?.[0]??null;
   if(active===7){if(explicitCode)serviceCode=explicitCode;}
   else{
    // The last digit of the official code is wrapped onto the monetary row.
    const suffix=identity?line.slice(identity.index!+identity[0].length).match(/^\s+([12])\s+/)?.[1]:null;
    if(suffix)serviceCode=`1.2.6.2.4.${suffix}`;
   }
   const resesCode=line.match(printedReses)![0];
   const tax=[...line.matchAll(/\d+%/g)].at(-1);
   const municipality=tax?(active===7
    ? line.slice(143,tax.index??line.length).trim().replace(/^(?:\d+\s+)+/,'')
    : line.slice(195,tax.index??line.length).trim().replace(/^(?:\d+\s+)+/,''))||null:null;
   result.push({annex:active,page:page.number,row:result.length+1,nif,observedProviderName:name,
    observedServiceCode:serviceCode,resesCode,municipality,quantity,amountCents,
    quote:line.trim().replace(/\s+/g,' ')});
   previousRow=index;
  }
 }
 return result;
}

/** The dispositive total is independent of the individual table rows. */
export function declaredEconomicAnnexTotal(text:string,annex:6|7):number|null{
 const normalized=text.replace(/\s+/g,' ');
 const expression=new RegExp(`([\\d.]+,\\d{2})\\s+euros,?\\s+IVA\\s+incl[oò]s,?\\s+detallat\\s+a\\s+l[’']Annex\\s+${annex}\\b`,'gi');
 const matches=[...normalized.matchAll(expression)];
 const value=matches.at(-1)?.[1];
 return value?Math.round(Number(value.replaceAll('.','').replace(',','.'))*100):null;
}

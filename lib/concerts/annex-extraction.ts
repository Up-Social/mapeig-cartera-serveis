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
export function parseEuroCents(value:string):number|null{
 if(!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(value))return null;
 const negative=value.startsWith('-');
 const [whole,fraction]=value.replace(/^-/, '').replaceAll('.','').split(',');
 const result=BigInt(whole)*BigInt(100)+BigInt(fraction);
 return result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(negative?-result:result):null;
}
const cents=(value:string)=>parseEuroCents(value)??NaN;

/** A JSON numeric value must retain enough precision to identify its cents. */
export function storedAmountCents(value:number|string|null,allowNegative=false):number|null{
 if(value===null||(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>=2**45)))return null;
 const text=String(value);
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(text)||(!allowNegative&&text.startsWith('-')))return null;
 const negative=text.startsWith('-');
 const [whole,fraction='']=text.replace(/^-/, '').split('.');
 const amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
 return amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(negative?-amount:amount):null;
}

/** Sum known exact cents. Callers must separately prevent reconciliation when any amount is missing. */
export function safeAnnexSum(values:Array<number|null>):number|null{
 if(values.some(value=>value!==null&&(!Number.isSafeInteger(value)||value<0)))return null;
 const sum=values.reduce<bigint>((total,value)=>total+BigInt(value??0),BigInt(0));
 return sum<=BigInt(Number.MAX_SAFE_INTEGER)?Number(sum):null;
}

export function extractConcertAnnexRows(text:string):ExtractedConcertLine[]{
 const rows:ExtractedConcertLine[]=[];
 const continuationPages:Array<{page:number;lines:string[];explicit:Array<{index:number;row:ExtractedConcertLine}>}>=[];
 for(const [index,pageText] of text.split('\f').entries()){
  const lines=pageText.split('\n');let previousRow=-1;
  const explicit:Array<{index:number;row:ExtractedConcertLine}>=[];
  for(const [lineIndex,line] of lines.entries()){
   const match=line.match(rowPattern);
   if(!match)continue;
   const quantity=Number(match[8]),amountCents=cents(match[9]);
   if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(amountCents)||amountCents<0)continue;
   const observedProviderName=printedColumn(lines,36,60,Math.max(previousRow+1,lineIndex-7),lineIndex);
   const row={page:index+1,row:rows.length+1,nif:match[1],serviceCode:match[2],resesCode:match[3],
    dispositionNumber:match[4],territory:match[5].trim(),effectiveStart:isoDate(match[6]),effectiveEnd:isoDate(match[7]),
    quantity,amountCents,quote:line.trim().replace(/\s+/g,' '),observedProviderName};
   rows.push(row);explicit.push({index:lineIndex,row});
   previousRow=lineIndex;
  }
  continuationPages.push({page:index+1,lines,explicit});
 }
 // Append inferred rows only after all explicit rows: their existing unit keys
 // depend on explicit-row numbering. Never carry context to another page.
 const continuations:ExtractedConcertLine[]=[];
 for(const {page,lines,explicit} of continuationPages){
  const header=lines.find(line=>line.includes('Nom tipologia de servei')&&line.includes('Codi S'));
  if(!header)continue;
  const start=header.indexOf('Nom tipologia de servei'),end=header.indexOf('Codi S',start);
  if(start<0||end<=start)continue;
  const explicitByLine=new Map(explicit.map(item=>[item.index,item.row]));
  let prior:{row:ExtractedConcertLine;description:string;index:number}|undefined,previousRow=lines.indexOf(header);
  const description=(lineIndex:number)=>lines.slice(Math.max(previousRow+1,lineIndex-7),lineIndex+1)
   .map(line=>line.slice(start,end).trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('ca');
  for(const [lineIndex,line] of lines.entries()){
   if(lineIndex>lines.indexOf(header)&&(/nom tipologia de servei/i.test(line)||/^\s*(?:annex\b|total\b)/i.test(line))){prior=undefined;previousRow=lineIndex;continue;}
   const found=explicitByLine.get(lineIndex);
   if(found){prior={row:found,description:description(lineIndex),index:lineIndex};previousRow=lineIndex;continue;}
   const nif=line.match(/\b[A-Z]\d{7}[0-9A-Z]\b/);
   if(!nif||nif.index===undefined)continue;
   if(!prior||line.slice(nif.index+nif[0].length,start).trim()){prior=undefined;previousRow=lineIndex;continue;}
   const currentDescription=description(lineIndex);
   if(currentDescription.length<12||currentDescription!==prior.description){prior=undefined;previousRow=lineIndex;continue;}
   const augmented=line.slice(0,nif.index+nif[0].length)+' '+prior.row.serviceCode+line.slice(nif.index+nif[0].length);
   const match=augmented.match(rowPattern);
   if(!match||match[1]!==prior.row.nif||match[3]!==prior.row.resesCode||match[4]!==prior.row.dispositionNumber||match[5].trim()!==prior.row.territory){prior=undefined;previousRow=lineIndex;continue;}
   const quantity=Number(match[8]),amountCents=cents(match[9]);
   if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(amountCents)||amountCents<0)continue;
   const row:ExtractedConcertLine={page,row:rows.length+continuations.length+1,nif:match[1],serviceCode:match[2],resesCode:match[3],
    dispositionNumber:match[4],territory:match[5].trim(),effectiveStart:isoDate(match[6]),effectiveEnd:isoDate(match[7]),quantity,amountCents,
    quote:lines.slice(prior.index,lineIndex+1).join('\n').trim().replace(/\s+/g,' '),observedProviderName:printedColumn(lines,36,60,Math.max(previousRow+1,lineIndex-7),lineIndex)};
   continuations.push(row);prior={row,description:currentDescription,index:prior.index};previousRow=lineIndex;
  }
 }
 return [...rows,...continuations];
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
 // Retain the original explicit-row numbering: persisted unit identities use it.
 // Append only continuation rows whose entity/disposition are printed above on
 // the same page, in a recognised table. Never inherit across a page or annex.
 const continuations:typeof rows=[];
 for(const [index,pageText] of text.split('\f').entries()){
  const lines=pageText.split('\n');
  const header=lines.find(line=>/NIF entitat/.test(line)&&/Disposició/.test(line)&&/Codi S/.test(line));
  if(!header)continue;
  const nifColumn=header.indexOf('NIF entitat'),nameColumn=header.indexOf('Nom entitat');
  const serviceColumn=header.indexOf('Tipologia de servei'),placesColumn=header.indexOf('Places');
  if(nameColumn<=nifColumn)continue;
  let identity:typeof rows[number]|null=null,identityLine=-1,lastServiceLine=-1;
  for(const [lineIndex,line] of lines.entries()){
   const explicit=line.match(/\b([A-Z]\d{7}[0-9A-Z])\b.+?\b(\d{10})\b.+?\b(S\d{5})\b/);
   if(explicit){identity=rows.find(row=>row.page===index+1&&row.nif===explicit[1]&&row.resesCode===explicit[3]&&row.quote===line.trim().replace(/\s+/g,' '))??null;identityLine=lineIndex;lastServiceLine=lineIndex;continue;}
   const reses=line.match(/\bS\d{5}\b/);
   if(!reses)continue;
   // A nonblank identity cell cannot be treated as a merged cell.
   if(line.slice(nifColumn,nameColumn).trim()){identity=null;continue;}
   if(!identity||lineIndex<=identityLine||!/[\d.]+,\d{2}\s*€/.test(line))continue;
   const disposition=line.slice(0,reses.index).match(/\b\d{10}\b/);
   if(disposition&&disposition[0]!==identity.dispositionNumber){identity=null;continue;}
   const quote=lines.slice(identityLine,lineIndex+1).join('\n').trim().replace(/\s+/g,' ');
   continuations.push({page:index+1,row:rows.length+continuations.length+1,nif:identity.nif,resesCode:reses[0],dispositionNumber:identity.dispositionNumber,
    observedProviderName:identity.observedProviderName,observedServiceName:serviceColumn>=0&&placesColumn>serviceColumn?printedColumn(lines,serviceColumn,placesColumn,Math.max(lastServiceLine+1,lineIndex-6),lineIndex):null,quote});
   lastServiceLine=lineIndex;
  }
 }
 return [...rows,...continuations];
}

/** Observations from the economic annex, before any service or entity is approved. */
export type EconomicAnnexLine={
 annex:0|6|7;page:number;row:number;nif:string|null;observedProviderName:string|null;
 observedServiceCode:string|null;observedServiceName?:string|null;resesCode:string;municipality:string|null;
 quantity:number|null;amountCents:number|null;quote:string;effectiveStart?:string;effectiveEnd?:string;
};

const printedMoney=/([\d.]+,\d{2})\s*€/gu;
const printedNif=/\b[A-Z]\d{7}[0-9A-Z]\b/u;
const printedReses=/\bS\d{5}\b/u;
const printedCode=/\b\d(?:\.\d+){2,6}(?:\.)?\b/u;
function annexPageParts(text:string){
 if(/^## Pàgina \d+/m.test(text))return text.split(/(?=^## Pàgina \d+\s*$)/m).filter(Boolean).map((value,index)=>({number:Number(value.match(/^## Pàgina (\d+)/)?.[1])||index+1,text:value}));
 return text.split('\f').map((value,index)=>({number:index+1,text:value}));
}

/** A separate column layout prints allocation rows without individual dates,
 * and sometimes without money. Do not derive amounts from monthly tariffs. */
export function extractColumnAnnexRows(text:string):EconomicAnnexLine[]{
 return extractColumnAnnexWithCoverage(text).rows;
}
export function extractColumnAnnexWithCoverage(text:string):{rows:EconomicAnnexLine[];complete:boolean;unparsedRows:number;declaredQuantity:number|null}{
 return extractColumnAnnexInternal(text);
}

/** Literal, display-only cell observations. They are not classifications or
 * evidence that the text extraction or archived bytes are current. The caller
 * must independently bind any observation to its document and stored unit. */
export type ColumnSupportObservation={page:number;row:number;resesCode:string;value:string};
export function extractColumnSupportObservations(text:string):ColumnSupportObservation[]{
 const found:Array<{line:EconomicAnnexLine;value:string}>=[];
 extractColumnAnnexInternal(text,found);
 return found.map(({line,value})=>({page:line.page,row:line.row,resesCode:line.resesCode,value}));
}

/** Literal service cells, separate from catalogue names and unchanged row keys. */
export function extractColumnServiceObservations(text:string):ColumnSupportObservation[]{
 const found:Array<{line:EconomicAnnexLine;value:string}>=[];
 extractColumnAnnexInternal(text,undefined,found);
 return found.map(({line,value})=>({page:line.page,row:line.row,resesCode:line.resesCode,value}));
}
export function extractColumnManagerObservations(text:string):Array<{page:number;value:string}>{
 const found:Array<{page:number;value:string}>=[];
 extractColumnAnnexInternal(text,undefined,undefined,found);
 return found;
}

function extractColumnAnnexInternal(text:string,supportObservations?:Array<{line:EconomicAnnexLine;value:string}>,serviceObservations?:Array<{line:EconomicAnnexLine;value:string}>,managerObservations?:Array<{page:number;value:string}>):{rows:EconomicAnnexLine[];complete:boolean;unparsedRows:number;declaredQuantity:number|null}{
 const rows:EconomicAnnexLine[]=[];
 // Previously archived keys include the row ordinal. Append incomplete-code
 // observations after fully recognised rows so adding one never renumbers an
 // already archived, fully recognised row.
 const incompleteCodeRows:EconomicAnnexLine[]=[];
 let unparsedRows=0;
 for(const page of annexPageParts(text)){
  const lines=page.text.split('\n');
  const headerIndex=lines.findIndex((line,index)=>(/Nom entitat/i.test(line)||(/\bNIF entitat\b/i.test(line)&&/\bNom\b/i.test(lines[index-1]??'')))&&/tipologia/i.test(lines.slice(Math.max(0,index-3),index+1).join(' '))&&/Codi S/i.test(line)&&/Nom servei/i.test(line)&&/Municipi/i.test(line)&&/assignar/i.test(line));
  if(headerIndex<0)continue;
  const header=lines[headerIndex];
  const managerStart=header.indexOf('gestor'),fueStart=header.indexOf('FUE',managerStart),nameStartForManager=header.indexOf('Nom entitat',managerStart);
  const managerEnd=fueStart>=0?fueStart:nameStartForManager;
  if(managerObservations&&managerStart>=0&&managerEnd>managerStart&&/\bCentre\b/.test(lines.slice(Math.max(0,headerIndex-2),headerIndex+1).join(' '))){
   for(const line of lines.slice(headerIndex+1)){
    const value=line.slice(managerStart,managerEnd).trim();
    if(/^[A-Z]{2}\d{4}$/.test(value))managerObservations.push({page:page.number,value});
   }
  }
  const supportHeadings=[...header.matchAll(/\bSuport\b/g)],resesHeadings=[...header.matchAll(/\bCodi S\b/g)];
  const supportStart=supportHeadings.length===1?supportHeadings[0].index:-1;
  const resesStart=resesHeadings.length===1?resesHeadings[0].index:-1;
  const nameStart=header.includes('Nom entitat')?header.indexOf('Nom entitat'):(lines[headerIndex-1]??'').indexOf('Nom');
  const nifStart=header.indexOf('NIF entitat'),municipalityStart=header.indexOf('Municipi'),quantityStart=header.indexOf('assignar');
  const codeStart=header.indexOf('cartera'),codeEnd=header.indexOf('Tipologia',codeStart)>=0?header.indexOf('Tipologia',codeStart):header.indexOf('servei',codeStart);
  const vatExempt=/exempt/i.test(lines.slice(Math.max(0,headerIndex-5),headerIndex+1).join(' '))&&/IVA/i.test(header);
  // Some one-period annexes print a daily tariff before the quantity and a
  // distinct period cost after it, with an inclusive-VAT caption. Only this
  // labelled cost column can supply the amount; never annualise the tariff.
  const inclusivePeriodCost=header.indexOf('diari')>=0&&header.indexOf('diari')<quantityStart&&
   /\(\s*IVA\s+incl[oò]s\s+si\s+escau\s*\)/i.test(header.slice(quantityStart))&&
   lines.slice(Math.max(0,headerIndex-5),headerIndex).some(line=>/\bCost\b/i.test(line.slice(quantityStart)));
  const taxStart=header.indexOf('IVA',municipalityStart);
  const municipalityEnd=taxStart>=0?taxStart:quantityStart;
  if(nameStart<0||municipalityStart<0||municipalityEnd<=municipalityStart||quantityStart<municipalityEnd)continue;
  let previousRow=headerIndex;
  let previousIdentity:{nif:string;name:string|null;disposition:string;index:number}|undefined;
  for(let index=headerIndex+1;index<lines.length;index++){
   const line=lines[index];
   if(/^\s*(?:annex|total)\b/i.test(line))break;
   const identity=line.match(/\b([A-Z]\d{7}[0-9A-Z])\b/u);
   const reses=line.match(/\bS\d{5}\b/u);
   if(!reses)continue;
   const from=Math.max(previousRow+1,index-8);
   const disposition=line.slice((reses.index??0)+reses[0].length).match(/\b\d{10}\b/)?.[0];
   const canInherit=!identity&&!!previousIdentity&&nifStart>=0&&codeStart>nifStart&&line.slice(nameStart,codeStart).trim()===''&&!!disposition&&disposition===previousIdentity.disposition;
   if((!identity||identity.index===undefined)&&!canInherit){unparsedRows++;previousIdentity=undefined;previousRow=index;continue;}
   const direct=identity?line.slice(identity.index!+identity[0].length).match(/^\s+(\d(?:\.\d+){2,6})\b/u)?.[1]:line.slice(codeStart,codeEnd).trim().match(/^(\d(?:\.\d+){2,6})(?=\s|$)/u)?.[1];
   const pieces=codeStart>=0&&codeEnd>codeStart?lines.slice(from,index+1).map(part=>part.slice(codeStart,codeEnd).trim()).filter(Boolean):[];
   const wrapped=pieces.length===2&&/^\d(?:\.\d+){2,6}$/.test(pieces[0])&&/^\.\d+$/.test(pieces[1]);
   const serviceCode=direct??(wrapped?pieces.join(''):null);
   // A missing or illegible code must not erase an otherwise identified line.
   // It remains unresolved, so coverage cannot be declared complete.
   const quantityMatch=line.slice(quantityStart).match(/^\s*(\d+)\b/);
   if(!quantityMatch){unparsedRows++;previousIdentity=undefined;previousRow=index;continue;}
   const quantity=Number(quantityMatch[1]);if(!Number.isSafeInteger(quantity)||quantity<1){unparsedRows++;previousIdentity=undefined;previousRow=index;continue;}
   let money=[...line.slice(quantityStart+quantityMatch[0].length).matchAll(/([\d.]+,\d{2})\s*€/gu)];
   // A split printed code and amount immediately above the same row belong to
   // that row only in this recognised, VAT-exempt column layout.
   if(!money.length&&wrapped&&vatExempt&&index>from)money=[...lines[index-1].slice(quantityStart+7).matchAll(/([\d.]+,\d{2})\s*€/gu)];
   const amountCents=/amb IVA/i.test(header)&&money.length===2?cents(money[1][1]):(vatExempt||inclusivePeriodCost)&&money.length===1?cents(money[0][1]):null;
   if(amountCents!==null&&(!Number.isSafeInteger(amountCents)||amountCents<0)){unparsedRows++;previousIdentity=undefined;previousRow=index;continue;}
   const municipality=lines.slice(from,index+1).map(part=>{
    // Headings can be centred over the field; do not cut the first or last
    // letter of a municipality whose printed word crosses the heading edge.
    let start=municipalityStart,end=municipalityEnd;
    const letter=(char:string|undefined)=>!!char&&/[\p{L}\p{M}]/u.test(char);
    while(start>0&&letter(part[start])&&letter(part[start-1]))start--;
    while(end<part.length&&letter(part[end-1])&&letter(part[end]))end++;
    return part.slice(start,end).trim();
   }).filter(Boolean).join(' ').replace(/\s+/g,' ').trim()||null;
   const nif=identity?.[1]??previousIdentity!.nif;
   const name=identity?printedColumn(lines,nameStart,identity.index!,from,index):previousIdentity!.name;
   const quoteFrom=canInherit?previousIdentity!.index:from;
   const row: EconomicAnnexLine={annex:0,page:page.number,row:0,nif,observedProviderName:name,
    observedServiceCode:serviceCode,resesCode:reses[0],municipality,quantity,amountCents,
    quote:lines.slice(quoteFrom,index+1).join('\n').trim().replace(/\s+/g,' ')};
   if(serviceCode){row.row=rows.length+1;rows.push(row);}else {unparsedRows++;incompleteCodeRows.push(row);}
   if(serviceObservations&&codeEnd>=0&&supportStart>codeEnd&&resesStart>supportStart){
    const value=lines.slice(from,index+1).map(part=>part.slice(codeEnd,supportStart).trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    if(/^serveis?\b/i.test(value))serviceObservations.push({line:row,value});
   }
   // The cell is read only on this row, with a single aligned RESES anchor.
   // Reject shifted, truncated or multi-token cells instead of guessing.
   if(supportObservations&&codeEnd>=0&&supportStart>codeEnd&&resesStart-supportStart>=6&&resesStart-supportStart<=16&&reses.index===resesStart&&
    [...line.matchAll(/\bS\d{5}\b/g)].length===1&&/\s/.test(line[supportStart-1]??' ')){
    const support=line.slice(supportStart,resesStart).trim();
    if(/^[A-Z][A-Z0-9]{1,7}$/.test(support))supportObservations.push({line:row,value:support});
   }
   previousIdentity=disposition?{nif,name,disposition,index:quoteFrom}:undefined;
   previousRow=index;
  }
 }
 for(const row of incompleteCodeRows){row.row=rows.length+1;rows.push(row);}
 const totals=[...text.replace(/\s+/g,' ').matchAll(/\btotal\s+general\s+(\d+)\b/gi)].map(match=>Number(match[1]));
 const unique=[...new Set(totals)];
 const declaredQuantity=unique.length===1&&Number.isSafeInteger(unique[0])&&unique[0]>0?unique[0]:null;
 return {rows,unparsedRows,declaredQuantity,complete:rows.length>0&&unparsedRows===0&&declaredQuantity!==null&&rows.reduce((sum,row)=>sum+(row.quantity??0),0)===declaredQuantity};
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
export function extractEconomicAnnexRows(text:string):Array<EconomicAnnexLine & {quantity:number;amountCents:number}>{
 const result:Array<EconomicAnnexLine & {quantity:number;amountCents:number}>=[];
 let active:6|7|null=null;
 for(const page of annexPageParts(text)){
  const lines=page.text.split('\n');let previousRow=-1;
  // A single page citation cannot substantiate identity on another page.
  // Preserve the next row with null identity instead of inheriting it.
  let nif='',name:string|null=null,serviceCode:string|null=null,lastDisposition:string|null=null,identityAnchor:number|null=null;
  const tableHeader=lines.find(line=>/\bNIF entitat\b/i.test(line)&&/\bCodi S\b/i.test(line)&&/Disposici[oó]/i.test(line));
  const clearIdentity=()=>{nif='';name=null;serviceCode=null;lastDisposition=null;identityAnchor=null;};
  for(let index=0;index<lines.length;index++){
   const line=lines[index];
   const heading=line.match(/^\s*ANNEX\s+([67])\s+IMPORTS\s+ECON[ÒO]MICS\s*$/i);
   if(heading){active=Number(heading[1]) as 6|7;clearIdentity();previousRow=index;continue;}
   if(/^\s*(?:#{1,6}\s*)?ANNEX\s+(?:\d+|[IVXLCDM]+)\b/i.test(line)){active=null;clearIdentity();previousRow=index;continue;}
   if(!active)continue;
   if(!printedReses.test(line)){
    const otherIdentity=line.match(printedNif)?.[0];
    if(otherIdentity&&otherIdentity!==nif){clearIdentity();previousRow=index;}
    continue;
   }
   if(!/[\d.]+,\d{2}\s*€\s*$/.test(line)){clearIdentity();previousRow=index;continue;}
   const amounts=[...line.matchAll(printedMoney)].map(match=>cents(match[1]));
   if(amounts.length<(active===7?3:2)||amounts.some(amount=>!Number.isSafeInteger(amount))){clearIdentity();previousRow=index;continue;}
   const amountCents=amounts.at(-1)!;
   const quantityMatch=line.match(active===7
    ? /[\d.]+,\d{2}\s*€\s+(\d+)\s+[\d.]+,\d{2}\s*€\s+[\d.]+,\d{2}\s*€\s*$/
    : /[\d.]+,\d{2}\s*€\s+(\d+)\s+[\d.]+,\d{2}\s*€\s*$/);
   const quantity=Number(quantityMatch?.[1]);
   if(!Number.isSafeInteger(amountCents)||amountCents<0||!Number.isSafeInteger(quantity)||quantity<1){clearIdentity();previousRow=index;continue;}
   const identity=line.match(printedNif);
   const printedResesIndex=line.search(printedReses);
   const disposition=line.slice(printedResesIndex+6).match(/\b\d{10}\b/)?.[0]??null;
   let inherited=false;
   if(identity){
    const sameIdentity=nif===identity[0];
    if(!sameIdentity)serviceCode=null;
    nif=identity[0];
    identityAnchor=Math.max(previousRow+1,tableHeader?lines.indexOf(tableHeader)+1:0,index-8);
    const start=active===7?19:47,end=identity.index??line.length;
    name=observedName(lines,identityAnchor,index,start,end)??(sameIdentity?name:null);
   }else{
    const nameColumn=tableHeader?.search(/\bNom entitat\b/i)??-1;
    const nifColumn=tableHeader?.search(/\bNIF entitat\b/i)??-1;
    const serviceColumn=tableHeader?.search(/\bcartera\b/i)??-1;
    const invalidIdentity=nifColumn<0||serviceColumn<=nifColumn||line.slice(nifColumn,serviceColumn).trim()!=='';
    const printedName=nameColumn>=0&&nifColumn>nameColumn?lines.slice(Math.max(previousRow+1,tableHeader?lines.indexOf(tableHeader)+1:0,index-8),index+1).map(part=>part.slice(nameColumn,nifColumn).trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim():'';
    const normalizeName=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const conflictingName=!!printedName&&(!name||normalizeName(printedName)!==normalizeName(name));
    if(!nif||identityAnchor===null||!lastDisposition||!disposition||disposition!==lastDisposition||invalidIdentity||conflictingName)clearIdentity();
    else inherited=true;
   }
   lastDisposition=nif?disposition:null;
   const explicitCode=line.match(printedCode)?.[0]??null;
   if(active===7){if(explicitCode)serviceCode=explicitCode;}
   else{
    const suffix=identity?line.slice(identity.index!+identity[0].length).match(/^(\s+)(\d+)\s+/):null;
    if(explicitCode)serviceCode=explicitCode;
    else if(identity){
     const column=suffix?identity.index!+identity[0].length+suffix[1].length:0;
     const prefix=suffix?lines.slice(Math.max(previousRow+1,index-8),index).reverse()
      .map(previous=>previous.slice(column).match(/^(\d+(?:\.\d+){2,}\.)\s+/)?.[1]).find(Boolean):null;
     serviceCode=prefix&&suffix?`${prefix}${suffix[2]}`:null;
    }
   }
   const resesCode=line.match(printedReses)![0];
   const tax=[...line.matchAll(/\d+%/g)].at(-1);
   const municipality=tax?(active===7
    ? line.slice(143,tax.index??line.length).trim().replace(/^(?:\d+\s+)+/,'')
    : line.slice(195,tax.index??line.length).trim().replace(/^(?:\d+\s+)+/,''))||null:null;
   const quote=inherited&&identityAnchor!==null?lines.slice(identityAnchor,index+1).join('\n').trim().replace(/\s+/g,' '):line.trim().replace(/\s+/g,' ');
   result.push({annex:active,page:page.number,row:result.length+1,nif:nif||null,observedProviderName:name,
    observedServiceCode:serviceCode,resesCode,municipality,quantity,amountCents,quote});
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
 const amounts=matches.map(match=>cents(match[1]));
 if(!amounts.length||amounts.some(value=>!Number.isSafeInteger(value)))return null;
 const unique=[...new Set(amounts)];
 return unique.length===1?unique[0]:null;
}

/** Return the literal operative maximum, and a following explicit reduction
 * condition if one is printed. This does not allocate it to individual rows. */
export function declaredGeneralAnnexMaximumEvidence(text:string):{amountCents:number;quote:string;condition:string|null}|null{
 const normalized=text.replace(/\s+/g,' ');
 const operative=normalized.match(/\bresolc\s*:/i);
 if(!operative||operative.index===undefined)return null;
 const body=normalized.slice(operative.index);
 const matches=[...body.matchAll(/import\s+total\s+m[aà]xim\s+(?:de\s+)?([\d.]+,\d{2})\s*(?:€|euros?)[^;]{0,100}?tal\s+com\s+s['’]indica\s+a\s+l['’]annex\b/gi)];
 const amounts=matches.map(match=>cents(match[1]));
 if(amounts.some(value=>!Number.isSafeInteger(value)))return null;
 const unique=[...new Set(amounts)];
 if(unique.length!==1)return null;
 const match=matches[0],following=body.slice(match.index!+match[0].length);
 // Repeated declarations with the same total may have different conditions;
 // don't attach one condition to an ambiguous selection of declarations.
 const condition=matches.length===1?following.match(/^\s*(?:d['’]aquesta\s+resoluci[oó])?\s*[.]\s*(En\s+cas\s+que\b[^.;]{0,400}?\b(?:reduir[aà]|reducci[oó])(?=\s|[.,;])[^.;]{0,200}[.;])/i)?.[1]??null:null;
 return {amountCents:unique[0],quote:match[0].trim(),condition};
}

/** An unnumbered annex can have a maximum explicitly stated in the operative
 * resolution. Multiple conflicting totals are ambiguous and stay unresolved. */
export function declaredGeneralAnnexTotal(text:string):{amountCents:number;kind:'maximum'}|null{
 const evidence=declaredGeneralAnnexMaximumEvidence(text);
 return evidence?{amountCents:evidence.amountCents,kind:'maximum'}:null;
}

/** A monetary total alone cannot establish that every row was extracted. */
export function declaredGeneralAnnexQuantity(text:string,amountCents:number):number|null{
 const normalized=text.replace(/\s+/g,' ');
 const totals=[...normalized.matchAll(/\btotal\s+general\s+(\d+)\s+([\d.]+,\d{2})\s*€/gi)];
 if(!totals.length||totals.some(match=>cents(match[2])!==amountCents))return null;
 const quantities=[...new Set(totals.map(match=>Number(match[1])))];
 return quantities.length===1&&Number.isSafeInteger(quantities[0])&&quantities[0]>0?quantities[0]:null;
}

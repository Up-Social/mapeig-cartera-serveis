import {allocateByWeights} from './evolution';
export type ProgramLine={page:number;row:number;nif:string;resesCode:string;dispositionNumber:string;position:string;quote:string;observedProviderName:string|null;observedServiceName:string|null;municipality:string|null;quantity:number|null;amountCents:number|null;annualCostCents:number|null;dispositionCents:number|null;amountBasis:'direct'|'allocated'|'unknown';modality:string|null};
const money=(s:string)=>{const v=s.match(/(-?[\d.]+,\d{2})\s*€/);return v?Math.round(Number(v[1].replaceAll('.','').replace(',','.'))*100):null;};
/** An amendment may reproduce the final annex after an old/new comparison.
 * Read the expressly reproduced annex once; never add the comparison tables to it. */
export function programDocumentScope(text:string):string {
 const operative=text.match(/reproduir[\s\S]{0,120}?totalitat[\s\S]{0,220}?a l[’']Annex\s+(\d+)/i);
 if(!operative)return text;
 const marker=new RegExp(`^\\s*Annex ${operative[1]}\\s*[:.]`,'im');
 const match=marker.exec(text);
 if(!match)return text;
 const before=text.slice(0,match.index),page=[...before.matchAll(/^## Pàgina (\d+)/gm)].at(-1)?.[1];
 return `${page?`## Pàgina ${page}\n`:''}${text.slice(match.index)}`;
}
/** Read printed column headings on every page. Wrapped cells belong to the next data row. */
export function extractProgramAnnex(text:string):ProgramLine[]{
 text=programDocumentScope(text);
 const markdown=/^## Pàgina \d+/m.test(text);const pages=markdown?text.split(/(?=^## Pàgina \d+\s*$)/m):text.split('\f');
 const result:ProgramLine[]=[];let identity:{nif:string;name:string|null;quoteStart:number}|null=null;let absolute=0;let disposition:string|null=null;let position='';
 for(const [pageIndex,page] of pages.entries()){
  const lines=page.split('\n');const h=lines.findIndex(l=>l.includes('NIF entitat')&&l.includes('Disposició')&&l.includes('Tipologia de servei'));
  if(h<0){identity=null;absolute+=page.length+(markdown?0:1);continue;}
  const header=lines[h];
  // Some PDFs print the second header row several blank lines below the first.
  // Read those labels too: otherwise the entity cell absorbs the GECAT reference.
  const headerRows=lines.slice(Math.max(0,h-2),h+10).filter(l=>/GECAT/.test(l)&&/finalista/.test(l));

  const labels=['NIF entitat','Nom entitat','GECAT','Disposició','Posició','finalista','inici','fi','Import assignat','assignat DA','assignar DA','assignat','Partida pressupostària','jurídic','FUE','Codi S','Nom servei','Municipi','Tipologia de servei','IVA','mesos','servei','Places','Cost anual','Cost anual amb IVA'];
  const cols=labels.map(label=>({label,start:header.indexOf(label,label==='fi'?header.indexOf('inici')+5:label==='servei'?header.indexOf('Tipologia de servei')+19:0)})).filter((c,i,all)=>c.start>=0&&!all.some((other,j)=>j<i&&other.start>=0&&c.start>=other.start&&c.start<other.start+other.label.length)).sort((a,b)=>a.start-b.start);
  for(const label of ['GECAT','finalista','inici','fi','jurídic','IVA']){
   if(cols.some(c=>c.label===label))continue;
   const row=headerRows.find(l=>l.includes(label));
   if(row){const start=row.indexOf(label,label==='fi'?row.indexOf('inici')+5:0);if(start>=0)cols.push({label,start});}
  }
  // Headings may be centred over left-aligned cells. Use actual block starts,
  // bounded around that heading, instead of cutting the first letters off.
  for(const label of ['Nom entitat','GECAT','Nom servei','Municipi']){
   const column=cols.find(c=>c.label===label);if(!column)continue;
   const starts=lines.slice(h+1).filter(l=>!headerRows.includes(l)).flatMap(l=>
    [...l.matchAll(/(?:^| {2,})(\S)/g)].map(m=>m.index!+m[0].length-1)
     .filter(i=>i<=column.start&&i>=column.start-10));
   if(starts.length)column.start=Math.min(...starts);
  }
  cols.sort((a,b)=>a.start-b.start);
  const serviceColumn=cols.find(c=>c.label==='Tipologia de servei');
  if(serviceColumn){
   const starts=lines.slice(h+1).flatMap(line=>[...line.matchAll(/(?:Servei|Suport|Llar|Centre|Residència)\b/g)].map(m=>m.index!).filter(i=>Math.abs(i-serviceColumn.start)<=12));
   if(starts.length)serviceColumn.start=Math.min(serviceColumn.start,...starts);
  }
  const cell=(line:string,label:string)=>{const i=cols.findIndex(c=>c.label===label);return i<0?'':line.slice(cols[i].start,cols[i+1]?.start).trim();};
  const wrapped=(from:number,to:number,label:string)=>lines.slice(from,to+1).filter(l=>!headerRows.includes(l)).map(l=>cell(l,label)).filter(s=>s&&!/^(GENERALITAT|NIF entitat|Nom entitat|Tipologia)/.test(s)).join(' ').replace(/\s+/g,' ').trim()||null;
  let previous=h;
  const carried=result.at(-1);
  if(carried?.observedServiceName?.endsWith('-')&&identity){
   const suffix:string[]=[];
   for(let j=h+1;j<lines.length;j++){
    const part=cell(lines[j],'Tipologia de servei');
    if(/\b[SC]\d{5}\b/.test(lines[j])||/^(Servei|Suport|Llar|Centre)/i.test(part))break;
    if(part){suffix.push(part);previous=j;}
   }
   if(suffix.length){carried.observedServiceName+=suffix.join(' ');carried.quote=text.slice(identity.quoteStart,absolute+lines.slice(0,previous+1).join('\n').length).trim().replace(/\s+/g,' ');}
  }
  for(let i=h+1;i<lines.length;i++){
   const line=lines[i],reses=line.match(/\b[SC]\d{5}\b/)?.[0];if(!reses){
    // Repeated tariff/quantity components belong to the preceding RESES, including across pages.
    const extra=line.match(/(?:^|\s)(\d+)\s+([\d.]+,\d{2}\s*€)\s+[\d.]+,\d{2}\s*€\s*$/),last=result.at(-1);
    if(last&&extra&&identity){
     last.annualCostCents=(last.annualCostCents??0)+money(extra[2])!;
     last.quantity=(last.quantity??0)+Number(extra[1]);
     last.quote=text.slice(identity?.quoteStart??0,absolute+lines.slice(0,i+1).join('\n').length).trim().replace(/\s+/g,' ');
    }
    continue;
   }
   const nifCell=cell(line,'NIF entitat'),nif=line.match(/\b[A-Z]\d{7}[0-9A-Z]\b/)?.[0];
   if(nifCell&&!nif){identity=null;previous=i;continue;}
   if(nif){identity={nif,name:wrapped(previous+1,i,'Nom entitat'),quoteStart:absolute+lines.slice(0,previous+1).join('\n').length+1};disposition=null;}
   if(!identity){previous=i;continue;}
   const printedDisposition=line.match(/\b\d{10}\b/)?.[0];
   if(printedDisposition){disposition=printedDisposition;position='';}const printedPosition=cell(line,'Posició').match(/^\d+/)?.[0];if(printedPosition)position=printedPosition;
   if(!disposition){previous=i;continue;}
   let serviceName=wrapped(previous+1,i,'Tipologia de servei');
   // A cell can end below its numeric row. Consume only continuation text before the next service heading.
   const nextText=cell(lines[i+1]??'','Tipologia de servei');
   let end=i;
   if(serviceName?.endsWith('-')&&nextText&&!/^(Servei|Suport|Llar|Centre)/i.test(nextText)&&!lines[i+1]?.match(/\b[SC]\d{5}\b/)){
    serviceName+=nextText;end=i+1;
   }
   const quoteEnd=absolute+lines.slice(0,end+1).join('\n').length;
   const normalizedText=text;
   const quote=normalizedText.slice(identity.quoteStart,quoteEnd).trim().replace(/\s+/g,' ');
   const tail=line.slice(line.indexOf(reses)+reses.length);const amounts=[...tail.matchAll(/[\d.]+,\d{2}\s*€/g)];const annual=amounts.at(-2);const places=annual?tail.slice(0,annual.index).match(/(\d+)\s*$/):null;const costs=amounts.slice(-2).map(m=>money(m[0]));
   result.push({page:Number(page.match(/^## Pàgina (\d+)/)?.[1])||pageIndex+1,row:result.length+1,nif:identity.nif,resesCode:reses,dispositionNumber:disposition,position,
    observedProviderName:identity.name,observedServiceName:serviceName,
    municipality:wrapped(previous+1,i,'Municipi'),quantity:places?Number(places[1]):null,
    dispositionCents:money(line.slice(0,line.indexOf(reses))),annualCostCents:costs[0]??null,
    amountCents:null,amountBasis:'unknown',modality:wrapped(previous+1,i,'jurídic'),quote});
   previous=end;
  }
  absolute+=page.length+(markdown?0:1);
 }
 const groups=new Map<string,ProgramLine[]>();for(const row of result){const key=`${row.nif}:${row.dispositionNumber}:${row.position}`;groups.set(key,[...(groups.get(key)??[]),row]);}
 for(const rows of groups.values()){
  const totals=[...new Set(rows.map(r=>r.dispositionCents).filter((n):n is number=>n!==null))];if(totals.length!==1)continue;
  if(rows.length===1){rows[0].amountCents=totals[0];rows[0].amountBasis='direct';continue;}
  if(rows.some(r=>r.annualCostCents===null)||!rows.some(r=>r.annualCostCents!>0))continue;
  const allocated=allocateByWeights(totals[0],rows.map(r=>r.annualCostCents!));rows.forEach((row,i)=>{row.amountCents=allocated[i];row.amountBasis='allocated';});
 }
 return result;
}

export function programCoverage(text:string,rows:ProgramLine[]){
 text=programDocumentScope(text);
 const candidates=text.split('\n').filter(l=>/\b[SC]\d{5}\b/.test(l)&&/[\d.]+,\d{2}\s*€/.test(l)).length;
 return {candidateRows:candidates,extractedRows:rows.length,unresolvedRows:Math.max(0,candidates-rows.length),complete:candidates>0&&candidates===rows.length,missingAmounts:rows.filter(r=>r.amountCents===null).length};
}

/** Reconcile independent tables only when each printed total matches its own rows. */
export function programDeclaredTotal(text:string,rows:ProgramLine[]):number|null{
 const scoped=programDocumentScope(text);
 const totals=[...scoped.matchAll(/\bTotal\s+(?:general\s+)?([\d.]+,\d{2})\s*€/gi)];
 const sum=rows.reduce((n,r)=>n+(r.amountCents??0),0);
 if(!rows.length||rows.some(r=>r.amountCents===null))return null;
 const value=(match:RegExpMatchArray)=>Math.round(Number(match[1].replaceAll('.','').replace(',','.'))*100);
 if(totals.some(match=>value(match)===sum))return sum;
 if(totals.length<2)return null;
 let offset=0,combined=0;const partitioned:ProgramLine[]=[];
 for(const total of totals){
  const section=scoped.slice(offset,total.index),part=extractProgramAnnex(section);
  if(!part.length||!programCoverage(section,part).complete||part.some(r=>r.amountCents===null)||part.reduce((n,r)=>n+r.amountCents!,0)!==value(total))return null;
  partitioned.push(...part);combined+=value(total);offset=total.index!+total[0].length;
 }
 const identity=(r:ProgramLine)=>[r.page,r.nif,r.resesCode,r.dispositionNumber,r.position,r.amountCents].join(':');
 if(combined!==sum||partitioned.map(identity).sort().join('|')!==rows.map(identity).sort().join('|'))return null;
 return combined;
}

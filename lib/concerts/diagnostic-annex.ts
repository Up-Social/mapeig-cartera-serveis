import {parseEuroCents,safeAnnexSum,type EconomicAnnexLine} from './annex-extraction';

/** Two-column VAT tables: group only repeated identity on the same printed
 * table and require each table's printed net and gross totals to reconcile. */
export function extractDiagnosticAnnex(text:string):EconomicAnnexLine[]{
 const starts=[...text.matchAll(/^[\t ]*ANNEX[\t ]+1[\t ]+Serveis[\t ]+assignats[\t ]*$/gim)];
 const ends=[...text.matchAll(/^[\t ]*ANNEX[\t ]+2\b/gim)];
 if(starts.length!==1||ends.length!==1||ends[0].index!<=starts[0].index!)return [];
 const firstPage=[...text.slice(0,starts[0].index!).matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)].at(-1)?.[1];
 if(!firstPage)return [];
 const scope=`## Pàgina ${firstPage}\n${text.slice(starts[0].index!,ends[0].index!)}`;
 const pages=scope.split(/(?=^##\s+Pàgina\s+\d+\s*$)/m);
 const operative=text.slice(0,starts[0].index!).match(/\bRESOLC\s*:/i);
 const periods=operative?[...text.slice(operative.index!+operative[0].length,starts[0].index!).matchAll(/per[ií]ode\s+compr[eè]s\s+entre\s+l[’']1\s+de\s+juliol\s+de\s+(20\d{2})\s+i\s+el\s+31\s+de\s+desembre\s+de\s+\1/gi)]:[];
 const period=periods.length===1?periods[0]:null;
 const out:EconomicAnnexLine[]=[];
 for(const page of pages){
  const n=Number(page.match(/^##\s+Pàgina\s+(\d+)\s*$/m)?.[1]);
  const candidates=page.split('\n').filter(line=>/\bS\d{5}\b/.test(line));
  const identityRows=page.split('\n').filter(line=>/\b[A-Z]\d{7}[A-Z0-9]\b/.test(line));
  if(!candidates.length){
   // An unrecognised table may still carry an economic subtotal. Never treat
   // the other pages as complete while that additional amount is unaccounted.
   if(/\bImport\s+total\b/i.test(page)||(/\b[A-Z]\d{7}[A-Z0-9]\b/.test(page)&&/\bNIF\b/i.test(page)))return [];
   continue;
  }
  if(!n||!/\bNIF\b/.test(page)||!/\bRESES\b/.test(page)||!/cartera/i.test(page)||!/sense IVA/i.test(page)||!/amb IVA/i.test(page))return [];
  const pattern=/\b([A-Z]\d{7}[A-Z0-9])\b[^\n]{0,160}?\b(S\d{5})\s+D\/[A-Z\d/]+\s+(\d(?:\.\d+){2,5})\s+([\d.]+,\d{2})\s*€\s+([\d.]+,\d{2})\s+euros\s+([\d.]+,\d{2})\s+euros/gi;
  const rows=[...page.matchAll(pattern)];
  if(!rows.length||rows.length!==candidates.length||rows.length!==identityRows.length)return [];
  const keys=new Set(rows.map(row=>`${row[1]}:${row[2]}:${row[3]}`));
  if(keys.size!==1||out.some(row=>row.nif===rows[0][1]&&row.resesCode===rows[0][2]))return [];
  // Only the explicitly identified paediatric component may be combined;
  // repeated identifiers alone do not prove that two services are identical.
  if(rows.length>1&&(rows.length!==2||!/Equip T[eè]cnic de Centre/i.test(page)||!/15h\/setmanals\s+Llicenciat/i.test(page)||!/Medicina.{0,300}especialitat\s+en\s+Pediatria/i.test(page.replace(/\s+/g,' '))))return [];
  const amounts=rows.map(row=>({net:parseEuroCents(row[5]),gross:parseEuroCents(row[6])}));
  if(amounts.some(v=>v.net===null||v.gross===null||!Number.isSafeInteger(v.net*11)||Math.round(v.net*11/10)!==v.gross))return [];
  const net=safeAnnexSum(amounts.map(x=>x.net)),gross=safeAnnexSum(amounts.map(x=>x.gross));
  const totals=[...page.matchAll(/\bImport\s+total\s+([\d.]+,\d{2})\s+euros\s+([\d.]+,\d{2})\s+euros/gi)];
  if(net===null||gross===null||totals.length!==1||parseEuroCents(totals[0][1])!==net||parseEuroCents(totals[0][2])!==gross)return [];
  const start=page.lastIndexOf('\n',rows[0].index!),end=totals[0].index!+totals[0][0].length;
  const quote=page.slice(start<0?0:start,end).trim().replace(/\s+/g,' ');
  if(quote.length<40)return [];
  const opening=text.slice(0,starts[0].index!).replace(/\s+/g,' ');
  const names=[...opening.matchAll(/de l[’']entitat\s+([^.!?]{3,140}?)\s*\(CIF\s*:\s*([A-Z]\d{7}[A-Z0-9])\)/gi)].filter(match=>match[2]===rows[0][1]).map(match=>match[1].trim());
  const distinctNames=[...new Set(names)];
  out.push({annex:0,page:n,row:out.length+1,nif:rows[0][1],resesCode:rows[0][2],observedServiceCode:rows[0][3],observedProviderName:distinctNames.length===1?distinctNames[0]:null,municipality:null,quantity:null,amountCents:gross,quote,...(period?{effectiveStart:`${period[1]}-07-01`,effectiveEnd:`${period[1]}-12-31`}:{})});
 }
 return out;
}

export function safeDiagnosticTotal(rows:EconomicAnnexLine[]){
 return rows.length&&rows.every(row=>row.amountCents!==null)?safeAnnexSum(rows.map(row=>row.amountCents)):null;
}

/** The operative maximum is printed without VAT; compare it to the net
 * service subtotals, keeping the gross aggregate explicitly calculated. */
export function diagnosticAnnexProof(text:string){
 const rows=extractDiagnosticAnnex(text);
 if(!rows.length)return null;
 const markers=[...text.matchAll(/\bRESOLC\s*:/gi)],annex=text.search(/^[\t ]*ANNEX[\t ]+1[\t ]+Serveis[\t ]+assignats[\t ]*$/im);
 if(markers.length!==1||annex<0||markers[0].index!>=annex)return null;
 const operative=text.slice(markers[0].index!+markers[0][0].length,annex).replace(/\s+/g,' ');
 const maxima=[...operative.matchAll(/\bimport\s+total\s+m[aà]xim\s+de\s+([\d.]+,\d{2})\s*€\s*,?\s+sense\s+IVA\b/gi)];
 if(maxima.length!==1)return null;
 const declaredNetCents=parseEuroCents(maxima[0][1]);
 const subtotals=rows.map(row=>{
  const totals=[...row.quote.matchAll(/\bImport\s+total\s+([\d.]+,\d{2})\s+euros\s+([\d.]+,\d{2})\s+euros/gi)];
  return totals.length===1?{netCents:parseEuroCents(totals[0][1]),grossCents:parseEuroCents(totals[0][2])}:null;
 });
 if(declaredNetCents===null||subtotals.some((value,i)=>!value||value.netCents===null||value.grossCents!==rows[i].amountCents))return null;
 const computedNetCents=safeAnnexSum(subtotals.map(value=>value!.netCents));
 const calculatedGrossCents=safeDiagnosticTotal(rows);
 if(computedNetCents!==declaredNetCents||calculatedGrossCents===null)return null;
 return {declaredNetCents,calculatedGrossCents,subtotals:rows.map((row,i)=>({page:row.page,resesCode:row.resesCode,netCents:subtotals[i]!.netCents!,grossCents:subtotals[i]!.grossCents!}))};
}

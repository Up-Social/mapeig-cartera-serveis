type QuantityLine={quantity:number|null;extraction_origin:string|null;quantity_delta?:number|null};

/** Display only quantities actually present; a missing value is not one or zero. */
export function concertQuantityCoverage(lines:ReadonlyArray<QuantityLine>,expectedServices:number|null):string {
 if(!lines.length)return 'Cap línia identificada';
 const programs=lines.filter(line=>line.extraction_origin==='program-columns-v2');
 const selected=programs.length?programs:lines;
 let total=0,known=0,overflow=false;
 for(const line of selected){
  if(typeof line.quantity!=='number'||!Number.isSafeInteger(line.quantity)||line.quantity<0)continue;
  known++;
  if(!Number.isSafeInteger(total+line.quantity))overflow=true;
  else if(!overflow)total+=line.quantity;
 }
 const missing=selected.length-known;
 // A modification annex gives the change of places, not a total: show it as such.
 if(!programs.length&&!known&&selected.every(line=>Number.isSafeInteger(line.quantity_delta))){
  const change=selected.reduce((sum,line)=>sum+line.quantity_delta!,0);
  return `Canvi de places identificat: ${change>0?'+':''}${change}${expectedServices?` · títol: ${expectedServices} serveis anunciats`:''}`;
 }
 const amount=overflow?'Suma de quantitats identificades no calculable':known?`${programs.length?'Suma de places identificades':'Suma de quantitats identificades'}: ${total}`:programs.length?'Places pendents de contrast':'Quantitat pendent de contrast';
 const pending=missing?` · ${missing} ${missing===1?'línia amb quantitat pendent':'línies amb quantitat pendent'}`:'';
 if(programs.length){
  const other=lines.length-programs.length;
  return `${amount}${pending} · ${programs.length} ${programs.length===1?'línia de programa':'línies de programa'}${other?` (no inclou ${other} ${other===1?'altra línia':'altres línies'})`:''}`;
 }
 return `${amount}${pending}${expectedServices?` · títol: ${expectedServices} serveis anunciats`:''}`;
}

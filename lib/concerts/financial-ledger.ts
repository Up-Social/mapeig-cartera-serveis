/** Financial projection for reviewed concert lines. All amounts are integer cents. */
export type ConcertFinancialLine={
 id:string;
 agreementKey:string;
 transactionKey:string;
 serviceCode:string;
 period:string;
 territory:string;
 funder:string;
 documentHash:string;
 lineReference:string;
 effectiveAt:string;
 operation:'award'|'renewal'|'delta'|'replacement'|'nonfinancial';
 amountCents:number|null;
 amountKind?:'exact'|'maximum'|'unknown';
 status:'draft'|'approved'|'rejected';
};
export type ConcertBalance={
 agreementKey:string;serviceCode:string;period:string;territory:string;funder:string;
 amountCents:number|null;transactionCount:number;maximum:boolean;issues:string[];
};

const validCents=(value:number|null)=>value===null||Number.isSafeInteger(value);
const scope=(item:ConcertFinancialLine)=>[item.agreementKey,item.serviceCode,item.period,item.territory,item.funder].join('\u0000');

/** Deduplicate publications of the same document line, then apply each transaction in time order. */
export function projectConcertBalances(lines:ConcertFinancialLine[]):ConcertBalance[]{
 const sorted=lines.filter(line=>line.status==='approved').sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt)||a.id.localeCompare(b.id));
 const seen=new Map<string,ConcertFinancialLine>();
 const transactions=new Map<string,{scope:string;amountCents:number|null;maximum:boolean;issues:string[]}>();
 for(const line of sorted){
  const identity=line.documentHash?[line.documentHash,line.lineReference,line.territory,line.period].join('\u0000'):line.id;
  const earlier=seen.get(identity);
  if(earlier){
   const same=earlier.transactionKey===line.transactionKey&&earlier.operation===line.operation&&earlier.amountCents===line.amountCents;
   if(!same){const key=`${scope(line)}\u0000${line.transactionKey}`;const state=transactions.get(key)??{scope:scope(line),amountCents:null,maximum:false,issues:[]};state.issues.push('La mateixa línia documental té interpretacions incompatibles.');state.amountCents=null;transactions.set(key,state);}
   continue;
  }
  seen.set(identity,line);
  if(line.operation==='nonfinancial')continue;
  const key=`${scope(line)}\u0000${line.transactionKey}`;
  const state=transactions.get(key)??{scope:scope(line),amountCents:null,maximum:false,issues:[]};
  if(!validCents(line.amountCents)){state.issues.push('Import sense precisió de cèntims.');state.amountCents=null;}
  else if(line.amountCents===null){
   state.issues.push('Import no acreditat.');state.amountCents=null;
  }else if(line.operation==='award'||line.operation==='renewal'){
   if(state.amountCents!==null)state.issues.push('Una segona adjudicació de la mateixa transacció requereix una relació explícita.');
   else if(line.amountCents<0)state.issues.push('Una adjudicació no pot tenir un import negatiu.');
   else state.amountCents=line.amountCents;
  }else if(line.operation==='delta'){
   if(state.amountCents===null)state.issues.push('No consta la base de la modificació.');
   else state.amountCents+=line.amountCents;
  }else if(line.operation==='replacement'){
   if(state.amountCents===null)state.issues.push('No consta la base que es vol substituir.');
   else if(line.amountCents<0)state.issues.push('El total substitutiu no pot ser negatiu.');
   else state.amountCents=line.amountCents;
  }
  if(line.amountKind==='maximum')state.maximum=true;
  transactions.set(key,state);
 }
 const grouped=new Map<string,ConcertBalance>();
 for(const state of transactions.values()){
  const [agreementKey,serviceCode,period,territory,funder]=state.scope.split('\u0000');
  const value=grouped.get(state.scope)??{agreementKey,serviceCode,period,territory,funder,amountCents:0,transactionCount:0,maximum:false,issues:[]};
  value.transactionCount++;
  value.maximum ||= state.maximum;
  value.issues.push(...state.issues);
  if(state.amountCents===null||state.issues.length)value.amountCents=null;
  else if(value.amountCents!==null)value.amountCents+=state.amountCents;
  grouped.set(state.scope,value);
 }
 return [...grouped.values()].sort((a,b)=>[a.agreementKey,a.serviceCode,a.period,a.territory,a.funder].join('|').localeCompare([b.agreementKey,b.serviceCode,b.period,b.territory,b.funder].join('|')));
}

/** Annual breakdown wins over the displayed total. Unallocated totals remain one period. */
export function allocatePlurianual(totalCents:number|null,annualities:Array<{year:number;amountCents:number}>):{rows:Array<{period:string;amountCents:number|null}>;issues:string[]}{
 if(!annualities.length)return {rows:[{period:'plurianual',amountCents:totalCents}],issues:totalCents===null?['Import total no acreditat.']:[]};
 const issues:string[]=[];
 if(new Set(annualities.map(row=>row.year)).size!==annualities.length)issues.push('Anualitat repetida.');
 if(annualities.some(row=>!Number.isSafeInteger(row.amountCents)||row.amountCents<0))issues.push('Anualitat amb import no vàlid.');
 if(totalCents!==null&&annualities.reduce((sum,row)=>sum+row.amountCents,0)!==totalCents)issues.push('La suma de les anualitats no coincideix amb el total del document.');
 return {rows:annualities.map(row=>({period:String(row.year),amountCents:row.amountCents})),issues};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractEconomicAnnexRows} from '../lib/concerts/annex-extraction';
import {planConcertAnnexReconciliation} from '../lib/cloud/concerts';

const annex7=readFileSync('tests/fixtures/official/dso-4390-2023-annex-7.txt','utf8');
const annex6=readFileSync('tests/fixtures/official/dsi-1984-2025-annex-6.txt','utf8');
const firstRow=annex7.split('\n').find(line=>line.includes('S06850')&&line.includes('€'))!;
const firstPagePrefix=annex7.slice(0,annex7.indexOf(firstRow))+firstRow;
const tableHeader=annex7.split('\n').find(line=>line.includes('NIF entitat')&&line.includes('Disposició')&&line.includes('Codi S'))!;
const blank=(text:string)=>' '.repeat(text.length);

test('independent economic annexes in one document have separate counts and sums',()=>{
 const text=`RESOLC: 388.817,48 euros, IVA inclòs, detallat a l’Annex 6. 7.511.518,52 euros, IVA inclòs, detallat a l’Annex 7.\n${annex6}\n${annex7}`;
 const rows=extractEconomicAnnexRows(text),plans=planConcertAnnexReconciliation('document',text,rows);
 assert.deepEqual(plans.map(p=>[p.annex,p.rows,p.sumCents,p.declaredCents,p.reconciled]),[[6,60,38881748,38881748,true],[7,115,751151852,751151852,true]]);
 assert.equal(new Set(rows.map(row=>`${row.annex}:${row.row}`)).size,175);
 const missing={...rows[0],amountCents:null};
 const zeroText='RESOLC: 0,00 euros, IVA inclòs, detallat a l’Annex 6.';
 assert.equal(planConcertAnnexReconciliation('document',zeroText,[missing])[0].reconciled,false);
});

test('a different annex stops economic extraction and a changed NIF cannot inherit a prior name',()=>{
 const later=firstRow.replace('Planiger, SA',blank('Planiger, SA')).replace('A83151977','B61441788').replace('S06850','S04549');
 const rows=extractEconomicAnnexRows(`${firstPagePrefix}\n${later}\nANNEX 8 ALTRES DADES\n${firstRow}`);
 assert.equal(rows.length,2);assert.equal(rows[0].observedProviderName,'Planiger, SA');
 assert.equal(rows[1].nif,'B61441788');assert.equal(rows[1].observedProviderName,null);
 assert.equal(extractEconomicAnnexRows(`${firstPagePrefix}\nANNEX VIII ALTRES DADES\n${firstRow}`).length,1);
});

test('identity across pages stays unknown even with repeated table and disposition',()=>{
 const inherited=firstRow.replace('Planiger, SA',blank('Planiger, SA')).replace('A83151977',blank('A83151977'));
 const continuous=`${firstPagePrefix}\n## Pàgina 33\n${tableHeader}\n${inherited}`;
 for(const text of [`${firstPagePrefix}\n## Pàgina 33\n${inherited}`,continuous,continuous.replace(/2600269934(?=\s+1 Camí)/g,'2600269999').replace('2600269999','2600269934')]){
  const rows=extractEconomicAnnexRows(text);assert.equal(rows.length,2);assert.equal(rows[1].nif,null);assert.equal(rows[1].observedProviderName,null);
 }
 const wrongName=inherited.replace(blank('Planiger, SA'),'Altra entitat');
 assert.equal(extractEconomicAnnexRows(`${firstPagePrefix}\n## Pàgina 33\n${tableHeader}\n${wrongName}`)[1].nif,null);
 const unreadable=firstRow.replace('A83151977','B61441788').replace('26.729,16 €','12.34,99 €');
 assert.equal(extractEconomicAnnexRows(`${firstPagePrefix}\n${unreadable}\n${inherited}`)[1].nif,null);
 assert.equal(extractEconomicAnnexRows(`${firstPagePrefix}\nB61441788\n${inherited}`)[1].nif,null);
});

test('malformed monetary grouping and unsafe cent values never become economic rows',()=>{
 const bad=firstPagePrefix.replace('26.729,16 €','12.34,99 €');
 assert.equal(extractEconomicAnnexRows(bad).length,0);
 const huge=firstPagePrefix.replace('26.729,16 €','90.071.992.547.409,92 €');
 assert.equal(extractEconomicAnnexRows(huge).length,0);
 const large=firstPagePrefix.replace('26.729,16 €','90.071.992.547.409,01 €');
 assert.equal(extractEconomicAnnexRows(large)[0].amountCents,9007199254740901);
});

test('a resumed multi-annex pass archives each line once and finalizes each annex separately',async()=>{
 const {prepareConcertObservations}=await import('../lib/cloud/concerts');
 const {sha256,sourcePath}=await import('../lib/source-storage');
 const bytes=Buffer.from('%PDF synthetic original source'),digest=sha256(bytes),recordId='record',docId='document';
 const source=sourcePath(recordId,docId,digest,'application/pdf',bytes);
 const secondBytes=Buffer.from('%PDF second synthetic source'),secondDigest=sha256(secondBytes),secondId='document-resolc';
 const secondSource=sourcePath(recordId,secondId,secondDigest,'application/pdf',secondBytes);
 const thirdBytes=Buffer.from('%PDF third synthetic source'),thirdDigest=sha256(thirdBytes),thirdId='document-z-column';
 const thirdSource=sourcePath(recordId,thirdId,thirdDigest,'application/pdf',thirdBytes);
 const text=`RESOLC: 388.817,48 euros, IVA inclòs, detallat a l’Annex 6. 7.511.518,52 euros, IVA inclòs, detallat a l’Annex 7.\n${annex6}\n${annex7}`;
 const document={id:docId,source_record_id:recordId,url:'https://example.invalid/source.pdf',status:'fetched',mime_type:'application/pdf',extraction_partial:false,storage_sha256:digest,storage_path:source,content_hash:digest,extracted_text:text};
 const clauses=Array.from({length:5},(_,i)=>`${i+1}. Assignar a l’entitat Fundació Prova ${i+1}, amb NIF G1234567${i+1}, 4 places del Servei d’acompanyament de joves, en règim de concert social a la comarca del Segrià. Nom del servei social: Pis Prova ${i+1} Núm. Expedient: PROVIS-0${i+1}. Número S1234${i+1}.`).join(' ');
 const secondDocument={...document,id:secondId,url:'https://example.invalid/second.pdf',storage_path:secondSource,storage_sha256:secondDigest,content_hash:secondDigest,extracted_text:`## Pàgina 2\nRESOLC: ${clauses} 6. Autoritzar la despesa.`};
 const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
 const line='Fundació Prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.4.1'.padEnd(15)+'Servei ocupacional'.padEnd(33)+'S10844'.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+'2';
 const thirdDocument={...document,id:thirdId,url:'https://example.invalid/third.pdf',storage_path:thirdSource,storage_sha256:thirdDigest,content_hash:thirdDigest,extracted_text:[header,line,'Total general 2'].join('\n')};
 const objects=new Map([[source,bytes],[secondSource,secondBytes],[thirdSource,thirdBytes]]),units=new Map<string,Record<string,unknown>>(),finalized:Array<{annex:number;rows:number;sum:number}>=[];
 const checkpoints=new Map<string,unknown>();let copies=0;const downloads:string[]=[];
 const storage={list:async(directory:string,options:{search:string})=>({data:[...objects.keys()].filter(key=>key===`${directory}/${options.search}`).map(()=>({name:options.search})),error:null}),
  download:async(path:string)=>{downloads.push(path);return {data:objects.has(path)?new Blob([Uint8Array.from(objects.get(path)!)]):null,error:null};},
  copy:async(from:string,to:string)=>{const content=objects.get(from);if(!content)return {data:null,error:Error('missing source')};copies++;objects.set(to,Buffer.from(content));return {data:{path:to},error:null};}};
 const db={storage:{from:()=>storage},rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name==='cloud_stage_concert_annex_line'){
   const line=args.p_line as Record<string,unknown>,lineDocument=String(args.p_document),lineDigest=lineDocument===thirdId?thirdDigest:digest,key=`official-annex:${lineDigest}:${line.annex}:${line.row}`;
   if(!units.has(key))units.set(key,{id:`unit-${units.size+1}`,unit_key:key,source_record_id:recordId,document_id:lineDocument,storage_path:null,storage_sha256:null,status:'draft',reviewed_at:null,observed_service_code:line.observedServiceCode,observed_provider_name:line.observedProviderName,provider_nif:line.nif,reses_code:line.resesCode,page:line.page,evidence_quote:line.quote,municipality:line.municipality,quantity:line.quantity,amount:line.amountCents===null?null:Number(line.amountCents)/100,quantity_delta:null});
   return {data:units.get(key)!.id,error:null};
  }
  if(name==='cloud_stage_concert_resolc_line'){
   const line=args.p_line as Record<string,unknown>,key=`official-resolc:${secondDigest}:${line.row}`;
   if(!units.has(key))units.set(key,{id:`unit-${units.size+1}`,unit_key:key,source_record_id:recordId,document_id:secondId,storage_path:null,storage_sha256:null,status:'draft',reviewed_at:null,observed_service_code:null,observed_provider_name:line.providerName,provider_nif:line.nif,reses_code:line.resesCode,page:line.page,evidence_quote:line.quote,municipality:null,quantity:line.quantity,amount:null,quantity_delta:null});
   return {data:units.get(key)!.id,error:null};
  }
  if(name==='publish_unit_source'){const unit=[...units.values()].find(value=>value.id===args.p_unit)!;unit.storage_path=args.p_new_path;unit.storage_sha256=args.p_new_sha256;return {data:unit.id,error:null};}
  if(name==='cloud_finalize_concert_annex'){
   const annex=Number(args.p_annex),lineDigest=args.p_document===thirdId?thirdDigest:digest,lines=[...units.values()].filter(unit=>String(unit.unit_key).startsWith(`official-annex:${lineDigest}:${annex}:`)&&unit.storage_path);
   if(lines.length!==args.p_rows)return {data:null,error:{code:'CONCERT_ARCHIVE_INCOMPLETE'}};
   finalized.push({annex,rows:Number(args.p_rows),sum:Number(args.p_sum_cents)});return {data:args.p_sum_cents===args.p_declared_cents,error:null};
  }
  if(name==='cloud_checkpoint'){checkpoints.set(String(args.p_key),args.p_value);return {data:true,error:null};}
  throw Error(`Unexpected RPC: ${name}`);
 },from(table:string){
  const filters:Record<string,unknown>={};let fields='';
  const query={select(value:string){fields=value;return query;},eq(key:string,value:unknown){filters[key]=value;return query;},neq(){return query;},order(){return query;},in(){return Promise.resolve({data:[],error:null});},
   range(from:number,to:number){const data=table==='source_documents'?[document,secondDocument,thirdDocument]:table==='record_units'&&fields.startsWith('id,unit_key')?[...units.values()]:[];return Promise.resolve({data:data.slice(from,to+1),error:null});},
   single(){const data=table==='source_records'?{id:recordId,title:'Resolució de provisió',source_record_id:'test',source_payload:{},financing_type:'concert'}:table==='source_documents'?(filters.id===secondId?secondDocument:filters.id===thirdId?thirdDocument:document):table==='record_units'?[...units.values()].find(value=>value.id===filters.id):null;return Promise.resolve({data,error:null});},
   maybeSingle(){const value=checkpoints.get(String(filters.item_key));return Promise.resolve({data:value?{value}:null,error:null});}};
  return query;
 }};
 const context={db:db as never,task:'task',owner:'owner',generation:1};let passes=0;
 while(!await prepareConcertObservations(context,{id:'job',source_record_id:recordId})){if(++passes>40)throw Error('Too many resumptions');}
 assert.equal(passes,36);assert.equal(units.size,181);assert.equal(copies,181);
 assert.ok(downloads.filter(path=>[source,secondSource,thirdSource].includes(path)).length<=passes+3,'each bounded pass must share source verification');
 assert.equal(downloads.filter(path=>path.includes('/items/')).length,181,'every copied unit must be verified');
 assert.ok(units.has(`official-resolc:${secondDigest}:1`),'an annex in a different document must not hide this narrative award');
 assert.ok(units.has(`official-annex:${thirdDigest}:0:1`),'a narrative observation in a different document must not hide this column annex');
 assert.deepEqual(finalized,[{annex:6,rows:60,sum:38881748},{annex:7,rows:115,sum:751151852},{annex:0,rows:1,sum:0}]);
 assert.equal(await prepareConcertObservations(context,{id:'job',source_record_id:recordId}),true);
 assert.equal(copies,181);assert.equal(finalized.length,3);
});

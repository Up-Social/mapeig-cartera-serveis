/* eslint-disable @typescript-eslint/no-explicit-any -- Preserve schema-versioned source snapshots and model proposals as JSON. */
import {createClient} from '@supabase/supabase-js';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {PILOT_API,PILOT_PROJECT,assertPilotTarget} from '../lib/convenis/pilot-budget';
const base='docs/local/piloto-convenis-2026-10-18',root=`${base}/ejecucion`;
const status=JSON.parse(execFileSync('supabase',['status','--workdir','.cache/convenis-pilot-runtime','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));assertPilotTarget(status.API_URL,PILOT_PROJECT);
const local=createClient(PILOT_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const sourceUrl=process.env.NEXT_PUBLIC_SUPABASE_URL!,sourceKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY!;
if(new URL(sourceUrl).origin!=='https://vvzxlevbfjvzygorbpxn.supabase.co')throw Error('Unexpected source');
const methods:Record<string,number>={};
const source=createClient(sourceUrl,sourceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{const method=(init?.method??'GET').toUpperCase();if(method!=='GET')throw Error('SOURCE_READ_ONLY');methods[method]=(methods[method]??0)+1;return fetch(input,init);}}});
const snapshot=JSON.parse(await readFile(`${root}/source-snapshot.json`,'utf8'));
const approved=JSON.parse(await readFile(`${base}/muestra-propuesta.json`,'utf8'));
const jobs=JSON.parse(await readFile(`${root}/jobs.json`,'utf8'));
const receipts=JSON.parse(await readFile(`${root}/receipts.json`,'utf8').catch(()=> '[]'));
const outcomes=JSON.parse(await readFile(`${root}/outcomes.json`,'utf8'));
const semanticFindings=JSON.parse(await readFile(`${root}/semantic-findings.json`,'utf8'));
const verifications=[];
for(const table of ['source_records','source_documents','pipeline_jobs','record_enrichments','analysis_results','review_decisions','service_provisions']){
 const ids=approved.rows.map((r:any)=>r.database_id);
 const res=await source.from(table).select('*').in(table==='source_records'?'id':'source_record_id',ids).order('id');if(res.error)throw res.error;
 const old=snapshot.data[table];
 const equal=JSON.stringify(res.data)===JSON.stringify(old);
 verifications.push({table,rows:res.data.length,unchanged:equal});
}
const sourceCatalog=await source.from('catalog_versions').select('*').eq('active',true).eq('validated',true).single();if(sourceCatalog.error)throw sourceCatalog.error;
verifications.push({table:'active_catalog',rows:1,unchanged:JSON.stringify(sourceCatalog.data)===JSON.stringify(snapshot.data.catalog_versions.find((c:any)=>c.active&&c.validated))});
const production={at:new Date().toISOString(),source:sourceUrl,methods,verifications,unchanged:verifications.every(v=>v.unchanged)};
await writeFile(`${root}/production-verification.json`,JSON.stringify(production,null,2));
if(!production.unchanged)throw Error('Source changed; review before claiming unchanged production');
const props=await local.from('conveni_unit_proposals').select('job_id,unit_id,data').in('job_id',jobs.members.map((m:any)=>m.jobId));if(props.error)throw props.error;
const analyses=await local.from('conveni_analyses').select('*').in('job_id',jobs.members.map((m:any)=>m.jobId));if(analyses.error)throw analyses.error;
const records=await local.from('source_records').select('id,source_record_id,amount,source_payload').in('id',approved.rows.map((m:any)=>m.database_id));if(records.error)throw records.error;
const provisions=await local.from('service_provisions').select('*');if(provisions.error)throw provisions.error;
const cost=receipts.reduce((n:number,r:any)=>n+(r.actual??0),0),reserved=receipts.filter((r:any)=>r.state!=='received').reduce((n:number,r:any)=>n+r.reserved,0);
const units=props.data.map(p=>({...p,officialId:jobs.members.find((m:any)=>m.jobId===p.job_id)?.official_id}));
const summary={at:new Date().toISOString(),project:PILOT_PROJECT,api:PILOT_API,app:'http://127.0.0.1:3118',catalog:sourceCatalog.data.id,runId:jobs.runId,records:outcomes.length,excluded:outcomes.filter((r:any)=>r.status==='excluded').length,proposed:outcomes.filter((r:any)=>r.status==='proposed').length,blocked:outcomes.filter((r:any)=>r.status==='blocked').length,paidCalls:receipts.length,receivedCalls:receipts.filter((r:any)=>r.state==='received').length,costUsd:cost,pendingReservationUsd:reserved,budgetUsd:6,units:units.length,unitsWithBlockers:units.filter(u=>u.data.blockers.length).length,activeProvisions:provisions.data.filter(p=>!p.superseded_at).length,productionUnchanged:true,humanValidation:'pending',outcomes};
await writeFile(`${root}/pilot-results.json`,JSON.stringify({summary,units,analyses:analyses.data},null,2));
const wb=new ExcelJS.Workbook();wb.creator='Mapeig cartera de serveis';
const cases=wb.addWorksheet('Resultats_24');cases.columns=[{header:'Conveni',key:'id',width:22},{header:'Cas',key:'label',width:42},{header:'Resultat tècnic',key:'status',width:20},{header:'Motiu / incidència',key:'reason',width:70},{header:'Unitats',key:'units',width:14},{header:'URL local',key:'url',width:65}];
for(const o of outcomes){const a=approved.rows.find((m:any)=>m.database_id===o.recordId);const finding=semanticFindings.find((f:any)=>f.officialId===o.officialId);cases.addRow({id:o.officialId,label:a.label,status:o.status,reason:[o.error??o.exclusion??'Proposta pendent de revisió humana',finding?.finding].filter(Boolean).join(' · '),units:o.units??0,url:{text:`Obrir ${o.officialId}`,hyperlink:`http://127.0.0.1:3118/records/${o.recordId}`}});}
const us=wb.addWorksheet('Propostes_NO_aprovades');us.columns=[['Conveni',24],['Receptor',48],['NIF',18],['Naturalesa',20],['Període',25],['Anualitat',14],['Import públic previst €',25],['Estat import',22],['Classificació proposada',28],['Servei proposat',24],['Població',50],['Bloquejos',65],['Evidència',100]].map(([header,width])=>({header:String(header),width:Number(width)}));
for(const u of units){const d=u.data;us.addRow([u.officialId,d.recipient,d.recipient_nif,d.recipient_nature,d.period,d.year,d.amount_cents===null?null:d.amount_cents/100,d.amount_state,d.classification,d.service_code,d.population,d.blockers.join('; '),d.evidence.map((e:any)=>`${e.document_id} p.${e.page}: ${e.quote}`).join('\n')]);}
const costs=wb.addWorksheet('Costos_IA');costs.columns=[['Conveni',24],['Estat',20],['Tokens entrada',20],['Tokens sortida',20],['Cost USD',22],['Reserva USD',22],['ID resposta',50]].map(([header,width])=>({header:String(header),width:Number(width)}));
for(const r of receipts){const m=approved.rows.find((m:any)=>m.database_id===r.recordId);costs.addRow([m.official_id,r.state,r.response?.usage?.input_tokens,r.response?.usage?.output_tokens,r.actual??null,r.reserved,r.response?.id??null]);}
const n=costs.rowCount+1;costs.addRow(['TOTAL','','','',{formula:`SUM(E2:E${n-1})`,result:cost},{formula:`SUM(F2:F${n-1})`,result:receipts.reduce((n:number,r:any)=>n+r.reserved,0)}]);
const notes=wb.addWorksheet('Abast');notes.columns=[{header:'Abast i limitacions',width:120}];for(const s of ['Propostes del pilot local; cap import és una provisió aprovada.','Revisió humana pendent. Les classificacions proposades no acrediten acceptació del client.',`Catàleg actiu conservat: ${sourceCatalog.data.id}.`,`Cost mesurat ${cost} USD; pressupost màxim 6 USD. No inclou OCR local ni infraestructura.`,`Producció: ${production.unchanged?'sense canvis en les taules verificades':'canvis detectats'}.`,'La correcció de cinc imports i la reversió s’han executat exclusivament a la còpia local.'])notes.addRow([s]);
for(const finding of semanticFindings)notes.addRow([`${finding.officialId}: ${finding.finding} No s’ha corregit ni aprovat la proposta de la IA.`]);
for(const sheet of wb.worksheets){sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={name:'Arial',bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};sheet.getRow(1).height=34;sheet.eachRow((row,i)=>{row.alignment={vertical:'top',wrapText:true};if(i>1)row.font={name:'Arial',size:10};});sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};}
us.getColumn(7).numFmt='#,##0.00';costs.getColumn(5).numFmt='0.000000';costs.getColumn(6).numFmt='0.000000';
await wb.xlsx.writeFile(`${base}/Resultados_Piloto_Sprint2.xlsx`);
console.log(JSON.stringify({...summary,outcomes:undefined},null,2));
console.log('Source verification: GET-only; all checked source rows and active catalog unchanged.');

"use client";
import {DocumentedCorrectionForm} from './human-resolution';
import {currentReservation} from '@/lib/human-resolution';
import {DocumentViewer} from './document-viewer';
import {useEffect,useMemo,useState} from 'react';
import type {SourceRecord} from '@/lib/workbench-types';
import {sourceDocumentTypeLabel} from '@/lib/ui-labels';
import {concertCaseKeys,type ConcertCaseKey} from '@/lib/concerts/case-labels';
import {ConcertCaseBadge} from './concert-case-badge';
import {ConcertEconomics} from './concert-economics';

type Unit={recovered_provider_name?:string|null;recovered_service_name?:string|null;document_id?:string;effective_service_code?:string|null;effective_provider_name?:string|null;observation?:{amountBasis?:string;annualCostCents?:number;dispositionNumber?:string;position?:string;pendingRevision?:boolean};id:string;pipeline_job_id:string|null;provider_name:string|null;observed_provider_name:string|null;provider_nif:string|null;centre:string|null;period:string|null;service_code:string|null;observed_service_code:string|null;observed_service_name:string|null;reses_code:string|null;observed_establishment_code?:string|null;territory:string|null;municipality:string|null;effective_start:string|null;effective_end:string|null;quantity:number|null;quantity_delta:number|null;amount:number|null;status:string;evidence_quote:string|null;review_note:string|null;page:number|null;act_type:string;storage_path:string|null;extraction_origin:string|null;horizon_state:string|null};
type Reconciliation={document_id:string;annex:number;row_count:number;sum_cents:number;declared_cents:number|null;reconciled:boolean};
type LinkedRecord={id:string;title:string;sourceRecordId:string;officialUrl:string|null;publishedAt:string|null};
type ConcertLink={id:string;direction:'anterior'|'posterior';kind:string;method:string;status:string;evidence:string;reviewNote:string|null;record:LinkedRecord|null};
const money=(value:number)=>new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(value);
const actCase:Record<string,ConcertCaseKey>={award:'award',renewal:'renewal',amendment:'amendment',modification:'modification',termination:'termination',cession:'cession',appeal:'appeal',validation:'validation'};
const linkCase:Record<string,ConcertCaseKey>={...actCase};

export function ConcertUnits({record,services,onSaved}:{record:SourceRecord;services:Array<{code:string;name:string}>;onSaved?:(record:SourceRecord)=>void}){
 const [supported,setSupported]=useState(true);
 const [loaded,setLoaded]=useState(false);
 const [units,setUnits]=useState<Unit[]>([]);
 const [reconciliations,setReconciliations]=useState<Reconciliation[]>([]);
 const [links,setLinks]=useState<ConcertLink[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [editingUnitId,setEditingUnitId]=useState<string|null>(null);
 const [showAllUnits,setShowAllUnits]=useState(false);
 const [filter,setFilter]=useState('');
 const [activeLine,setActiveLine]=useState<string|null>(null);
 const [bulkNote,setBulkNote]=useState('');
 const [editedNames,setEditedNames]=useState<Record<string,string>>({});
 const url=`/api/records/${record.id}/units`;
 useEffect(()=>{function focus(){const hash=window.location.hash;if(hash.startsWith('#concert-line-')){setActiveLine(hash.slice(14));setShowAllUnits(true);setFilter('');}}
  focus();window.addEventListener('hashchange',focus);return()=>window.removeEventListener('hashchange',focus);},[]);

 useEffect(()=>{const c=new AbortController();fetch(url,{signal:c.signal}).then(r=>r.json()).then(data=>{if(data.error)setError(data.error);else{setLoaded(true);setSupported(data.supported!==false);setUnits(data.units??[]);setReconciliations(data.reconciliations??[]);}}).catch(e=>{if(e.name!=='AbortError')setError('No s’han pogut carregar les unitats');});return()=>c.abort();},[url,record.corrections]);
 useEffect(()=>{const c=new AbortController();fetch(`/api/records/${record.id}/concert-links`,{signal:c.signal,cache:'no-store'}).then(r=>r.json()).then(data=>{if(data.error)setError(data.error);else setLinks(data.links??[]);}).catch(e=>{if(e.name!=='AbortError')setError('No s’han pogut carregar els vincles');});return()=>c.abort();},[record.id]);
 async function submit(body:Record<string,unknown>){
  setBusy(true);setError('');
  try{
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,expectedJobId:record.currentJobId}),signal:AbortSignal.timeout(20000)});
   const data=await r.json();if(!r.ok)throw Error(data.error);
   const current=await fetch(url,{signal:AbortSignal.timeout(15000)}).then(r=>r.json());if(current.error)throw Error(current.error);
   setUnits(current.units);setEditingUnitId(null);
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut guardar');}finally{setBusy(false);}
 }
 async function reviewAll(){
  if(!record.currentJobId||!(showAllUnits||units.length<=6)||bulkNote.trim().length<10)return;
  setBusy(true);setError('');
  try{
   const response=await fetch(`/api/records/${record.id}/concert-review`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({expectedJobId:record.currentJobId,note:bulkNote,names:Object.fromEntries(units.map(u=>[u.id,editedNames[u.id]??u.effective_provider_name??u.provider_name??u.recovered_provider_name??u.observed_provider_name??'']))}),signal:AbortSignal.timeout(120000)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error??'No s’ha pogut validar el repartiment');
   window.location.reload();
  }catch(cause){setError(cause instanceof Error?cause.message:'No s’ha pogut validar el repartiment');setBusy(false);}
 }
 useEffect(()=>{if(activeLine&&units.length){const frame=requestAnimationFrame(()=>document.getElementById(`concert-line-${activeLine}`)?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(frame);}},[activeLine,units]);
 const serviceByCode=useMemo(()=>new Map(services.map(service=>[service.code,service.name])),[services]);
 if(!supported)return <section id="unitats" className="surface p-5"><h2 className="section-title">Repartiment del concert</h2><p className="mt-2 text-sm">El desglossament per entitats està pendent d’activació en aquesta base de dades.</p></section>;
 if(!loaded)return <section id="unitats" className="surface min-w-0 p-5"><h2 className="section-title">Repartiment del concert</h2>{error?<p role="alert" className="mt-2 text-sm">{error}</p>:<p role="status" className="mt-2 text-sm">Carregant les línies de l’annex…</p>}</section>;
 const allowed=!record.isHistorical&&['approved','corrected'].includes(record.currentJobStatus??'');
 const expected=Number(record.title.match(/\b(\d+)\s+serveis\b/i)?.[1]);
 const knownExpected=Number.isInteger(expected)&&expected>0?expected:null;
 const represented=units.reduce((total,unit)=>total+(unit.quantity??1),0);
 const programRows=units.filter(unit=>unit.extraction_origin==='program-columns-v2');
 const programPlaces=programRows.reduce((total,unit)=>total+(unit.quantity??0),0);
 const programTypes=new Set(programRows.map(unit=>unit.service_code??unit.observed_service_code??unit.observed_service_name).filter(Boolean)).size;
 const reviewed=units.filter(unit=>unit.status==='approved').length;
 const uniqueProviders=new Set(units.map(unit=>unit.provider_nif??unit.provider_name??unit.observed_provider_name).filter(Boolean)).size;
 const identifiedAmount=units.filter(unit=>unit.amount!=null).reduce((sum,unit)=>sum+Number(unit.amount),0);
 const pricedLines=units.filter(unit=>unit.amount!=null).length;
 const missingOlderOrigin=units.some(unit=>unit.horizon_state==='pre_2024_origin_unavailable');
 const reconciled=reconciliations.find(item=>item.reconciled&&item.row_count===units.length);
 const bulkEligible=!currentReservation(record)&&!record.corrections?.some(c=>!c.valid)&&!!reconciled&&!record.isHistorical&&record.currentJobStatus==='needs_review'&&
  ['concert-reconciled-annex-v1','concert-program-lines-v2'].includes(record.analysis?.rules_version??'')&&units.every(unit=>unit.status==='draft'&&!!unit.storage_path&&!!(unit.effective_service_code??unit.observed_service_code));
 const officialText=record.sourceDocuments.filter(document=>document.status==='fetched'&&document.extractedText&&
  !document.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag)))
  .sort((left,right)=>(right.textLength??0)-(left.textLength??0))[0]?.extractedText;
 const caseKeys=concertCaseKeys(record.title,units.map(unit=>unit.act_type),officialText);
 const primary=caseKeys[0],attributes=caseKeys.slice(1);
 const filteredUnits=units.filter(unit=>`${unit.effective_provider_name??unit.provider_name??unit.recovered_provider_name??unit.observed_provider_name} ${unit.service_code??unit.effective_service_code??unit.observed_service_code} ${unit.observed_service_name} ${unit.provider_nif} ${unit.reses_code}`.toLocaleLowerCase('ca').includes(filter.toLocaleLowerCase('ca')));
 const visibleUnits=showAllUnits||filteredUnits.length<=6?filteredUnits:filteredUnits.slice(0,6);

 const serviceGroups=new Map<string,{title:string;code:string|null;rows:Array<{unit:Unit;index:number}>}>();
 visibleUnits.forEach((unit)=>{
  const code=unit.service_code??unit.effective_service_code??unit.observed_service_code;
  const title=(code&&serviceByCode.get(code))??unit.recovered_service_name??unit.observed_service_name??'Servei pendent de contrastar';
  const key=code??title;
  if(!serviceGroups.has(key))serviceGroups.set(key,{title,code,rows:[]});
  serviceGroups.get(key)!.rows.push({unit,index:units.findIndex(u=>u.id===unit.id)});
 });
 const orderedServiceGroups=[...serviceGroups.entries()].sort(([,left],[,right])=>
  Number(left.title==='Servei pendent de contrastar')-Number(right.title==='Servei pendent de contrastar')
 );
 return <section id="unitats" className="surface min-w-0 space-y-6 p-4 [overflow-wrap:anywhere] sm:p-6">
  <div>
   <p className="page-eyebrow">Concert social · lectura de l’expedient</p>
   <h2 className="section-title mt-1">{units.length===1?"Entitat, servei i seguiment del concert":"Repartiment i seguiment del concert"}</h2>
   <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">L’acte descriu què publica l’Administració. El repartiment mostra cada entitat i servei de l’annex. L’evolució agrupa les resolucions que poden canviar aquest concert. Obre «Revisar línia» per contrastar-ne les dades amb el PDF. La validació de l’annex és conjunta.</p>
   <div className="mt-3 flex flex-wrap gap-2" aria-label="Casuístiques detectades pel títol i l’annex"><ConcertCaseBadge kind={primary}/>{attributes.map(kind=><ConcertCaseBadge key={kind} kind={kind}/>)}<span className="self-center text-xs text-muted-foreground">Lectura preliminar del títol; contrasta-la amb el PDF.</span></div>
   <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Navegació del concert"><a className="rounded-md border px-3 py-2 font-medium underline underline-offset-2" href="#concert-distribution">Veure repartiment per entitat</a><a className="rounded-md border px-3 py-2 font-medium underline underline-offset-2" href="#concert-history">Veure modificacions {links.length?`(${links.length})`:''}</a><a className="rounded-md border px-3 py-2 font-medium underline underline-offset-2" href="#concert-economics">Revisar vincles i imports</a></nav>
  </div>

  <div className="grid gap-3 sm:grid-cols-3" data-testid="concert-coverage">
   <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línies de l’annex</p><p className="mt-1 text-2xl font-bold tabular-nums">{units.length}</p><p className="text-xs text-muted-foreground">{programRows.length?`${programTypes} tipologies · ${programPlaces} places llegides`: `${represented} serveis representats${knownExpected?` de ${knownExpected} anunciats`:''}`}</p></div>
   <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entitats identificades</p><p className="mt-1 text-2xl font-bold tabular-nums">{uniqueProviders}</p><p className="text-xs text-muted-foreground">Segons el NIF de cada línia; {reviewed} línies aprovades</p></div>
   <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-sky-900">Import de les línies identificades</p><p className="mt-1 text-2xl font-bold tabular-nums text-sky-950">{pricedLines?money(identifiedAmount):'No atribuïble'}</p><p className="text-xs text-sky-900">{pricedLines} de {units.length} línies amb import · encara no és el saldo vigent</p></div>
  </div>
  {missingOlderOrigin&&<p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Hi ha línies amb origen anterior a 2024. Es conserven els imports documentals, però no se sumen a la foto vigent sense un original dins de l’horitzó.</p>}
  {reconciliations.length>0&&<p role="status" className={`rounded-lg border p-3 text-sm ${reconciled?'border-emerald-300 bg-emerald-50 text-emerald-950':'border-amber-300 bg-amber-50 text-amber-950'}`}>
   {reconciled?`Annex ${reconciled.annex} llegit complet: ${reconciled.row_count} línies i ${money(reconciled.sum_cents/100)}. La suma coincideix amb la resolució; pendent de validació humana i de vincular els actes posteriors.`:
    'Hi ha línies documentals, però el total de l’annex encara no està conciliat. No es poden aprovar com a conjunt.'}
  </p>}

  <section id="concert-distribution" className="scroll-mt-32" aria-labelledby="distribution-title" data-testid="concert-distribution">
   <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="page-eyebrow">01 · Distribució</p><h3 id="distribution-title" className="text-xl font-semibold">{units.length===1?"Entitat, servei i import":"Entitats, serveis i imports"}</h3></div><p className="text-xs text-muted-foreground">Una fitxa per línia de l’annex · {units.length} línies</p></div>
   {!units.length&&<p className="mt-3 rounded-lg border p-4 text-sm">Aquest acte no té línies de repartiment verificades. Consulta l’evolució per veure la resolució relacionada.</p>}
   {units.length>6&&<label className="mt-4 block text-sm font-medium">Cercar una línia per entitat, servei, NIF o RESES<input className="form-text mt-1 block w-full" value={filter} onChange={e=>setFilter(e.target.value)}/><span className="mt-1 block text-xs text-muted-foreground">{filteredUnits.length} de {units.length} línies</span></label>}
   <div className="mt-4 grid gap-4">
    {orderedServiceGroups.map(([groupKey,group])=><section key={groupKey} className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 sm:p-4" data-testid="concert-service-group">
     {units.length>1&&<div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servei de l’annex</p><h4 className="mt-1 break-words text-lg font-bold">{group.title}</h4>{group.code&&<p className="text-xs text-muted-foreground">Codi de Cartera observat: {group.code}</p>}</div><p className="text-xs text-muted-foreground">{group.rows.length} {group.rows.length===1?'línia visible':'línies visibles'}</p></div>}
     <div className="mt-3 grid gap-3">
    {group.rows.map(({unit,index})=>{
     const entity=unit.effective_provider_name??unit.provider_name??unit.recovered_provider_name??unit.observed_provider_name;
     const code=unit.service_code??unit.effective_service_code??unit.observed_service_code;
     const service=(code&&serviceByCode.get(code))??unit.recovered_service_name??unit.observed_service_name;
     const act=actCase[unit.act_type];
     return <article id={`concert-line-${unit.id}`} key={unit.id} className="min-w-0 scroll-mt-32 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5" data-testid="concert-unit">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]">
       <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línia {index+1} · Entitat</p><h5 className="mt-1 break-words text-lg font-bold leading-snug">{entity??'Nom de l’entitat pendent de verificar'}</h5>
        {entity&&!unit.provider_name&&<p className="mt-1 text-xs text-amber-800">{unit.recovered_provider_name?'Nom recuperat del mateix PDF · pendent de validar':'Nom llegit a l’annex · pendent de validar'}</p>}

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servei</p><p className="mt-1 break-words text-base font-semibold">{service??'Nom del servei pendent de contrastar'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{code?`Codi de Cartera observat: ${code}`:'Codi de Cartera pendent'}{unit.reses_code?` · RESES ${unit.reses_code}`:unit.observed_establishment_code?` · Codi del document ${unit.observed_establishment_code}`:''}</p>
        {code&&services.some(s=>s.code.startsWith(`${code}.`))&&<p className="mt-1 text-xs text-amber-900">Nivell específic no indicat · es conserva el codi agrupador acreditat.</p>}
        {unit.observation?.pendingRevision&&<p role="status" className="mt-2 text-sm text-amber-900">Hi ha una nova extracció pendent de revisar; es conserva la decisió humana anterior.</p>}
       </div>
       <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 lg:text-right"><p className="text-xs font-semibold uppercase tracking-wide text-sky-900">Import individual</p><p className="mt-1 break-words text-2xl font-bold tabular-nums text-sky-950">{unit.amount==null?'No acreditat':money(Number(unit.amount))}</p><p className="mt-1 text-xs leading-5 text-sky-900">{unit.amount==null?'L’extracció actual no acredita un import individual. Revisa el PDF o la conciliació.':unit.observation?.amountBasis==='allocated'?`Import repartit proporcionalment segons els costos anuals de la disposició ${unit.observation.dispositionNumber}, posició ${unit.observation.position}. Pendent de revisió.`:'Import de la línia segons l’annex; pendent de revisió.'}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
       {act&&<ConcertCaseBadge kind={act}/>}<span className="rounded-full border px-2.5 py-1">{unit.status==='approved'?'Línia aprovada':unit.status==='rejected'?'Línia rebutjada':'Pendent de revisió'}</span>
       {unit.provider_nif&&<span>NIF {unit.provider_nif}</span>}{unit.centre&&<span>Centre: {unit.centre}</span>}{(unit.municipality||unit.territory)&&<span>{unit.municipality??unit.territory}</span>}{unit.period&&<span>Període {unit.period}</span>}{unit.quantity_delta!=null&&<span>Canvi de places: {unit.quantity_delta>0?'+':''}{unit.quantity_delta}</span>}{unit.quantity&&<span>{unit.quantity} {unit.extraction_origin==='program-columns-v2'?(unit.quantity===1?'plaça':'places'):(unit.quantity===1?'servei':'serveis')}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-expanded={activeLine===unit.id} aria-controls={`line-review-${unit.id}`} className="rounded-md border px-3 py-2 text-sm font-semibold" onClick={()=>setActiveLine(activeLine===unit.id?null:unit.id)}>{activeLine===unit.id?'Tancar revisió':'Revisar línia'}</button><a className="rounded-md border px-3 py-2 text-sm underline" href={`#concert-effect-${unit.id}`}>Revisar import i període</a></div>
      {activeLine===unit.id&&<div id={`line-review-${unit.id}`} className="mt-4 space-y-3 border-t pt-4">
        {bulkEligible&&<label className="mt-2 block text-xs font-semibold">Nom que constarà al resultat<input className="form-text mt-1 w-full text-sm font-normal" value={editedNames[unit.id]??entity??''} onChange={event=>setEditedNames(value=>({...value,[unit.id]:event.target.value}))} minLength={3} maxLength={300} aria-label={`Nom de l’entitat de la línia ${index+1}`}/><span className="mt-1 block font-normal">Aquest nom es desarà quan validis el repartiment complet.</span></label>}
      <div className="rounded-lg bg-muted/20 p-3 text-sm"><h6 className="font-semibold">Evidència documental · pàgina {unit.page??'pendent'}</h6>
       <blockquote className="mt-3 break-words whitespace-pre-wrap border-l-2 pl-3 leading-6">{unit.evidence_quote?.replace(/\s+/g,' ')??'Cita pendent'}</blockquote><p className="mt-2 break-all text-xs">ID de la línia: {unit.id}</p>
       {unit.recovered_provider_name&&<p className="mt-2 text-xs text-muted-foreground">Lectura guardada anterior: {unit.observed_provider_name}. El nom recuperat és una proposta de lectura del mateix PDF.</p>}
       <p className="mt-2">{unit.storage_path?<a href={`${url}/${unit.id}/source`} target="_blank" rel="noopener noreferrer" className="underline" title="Obre el PDF oficial guardat per a aquesta línia">Obre la còpia arxivada</a>:'Font pendent d’arxivar a Storage'}</p>
       {unit.storage_path&&<DocumentViewer url={`${url}/${unit.id}/source`} page={unit.page??1} label="Comprovar la pàgina del PDF aquí"/>}
       {unit.review_note&&<p className="mt-2">Revisió: {unit.review_note}</p>}
      </div>

      {allowed&&unit.status==='draft'&&unit.extraction_origin&&!unit.pipeline_job_id&&unit.observed_service_code&&<div className="mt-3"><button type="button" className="rounded border px-3 py-2 text-sm" title="Confirma el nom de l’entitat i el codi del servei abans de revisar la línia" onClick={()=>setEditingUnitId(editingUnitId===unit.id?null:unit.id)}>Completa la línia per revisar-la</button>
       {editingUnitId===unit.id&&<form className="mt-2 grid gap-2 rounded border p-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void submit({prepareExtractedUnitId:unit.id,providerName:form.get('provider_name'),serviceCode:unit.observed_service_code});}}><label>Nom complet de l’entitat segons el PDF<input className="form-text mt-1 w-full" name="provider_name" defaultValue={entity??''} minLength={3} required/></label><p className="text-sm">NIF {unit.provider_nif} · RESES {unit.reses_code} · codi {unit.observed_service_code}. Confirma el nom abans d’aprovar.</p><button className="rounded border px-3 py-2" title="Desa el nom contrastat; no aprova la línia" disabled={busy}>Desar identificació de la línia</button></form>}
      </div>}
      {unit.status==='draft'&&!unit.pipeline_job_id&&onSaved&&<DocumentedCorrectionForm record={record} services={services} unitId={unit.id} documentId={unit.document_id} initialPage={unit.page??1} onSaved={onSaved}/>}
      {allowed&&unit.status==='draft'&&(!unit.extraction_origin||unit.pipeline_job_id)&&<div className="mt-3 space-y-2"><label className="block">Justificació de la unitat<textarea className="form-text w-full" value={notes[unit.id]??''} onChange={e=>setNotes({...notes,[unit.id]:e.target.value})}/></label><div className="flex flex-wrap gap-2"><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="rounded border px-3 py-2 disabled:opacity-50" title="Aprova només aquesta línia després de contrastar la font" onClick={()=>void submit({unitId:unit.id,approve:true,note:notes[unit.id]})}>Aprovar unitat</button><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="rounded border px-3 py-2 disabled:opacity-50" title="Rebutja només aquesta línia i conserva la justificació" onClick={()=>void submit({unitId:unit.id,approve:false,note:notes[unit.id]})}>Rebutjar unitat</button></div></div>}
      </div>}
     </article>;
    })}
     </div>
    </section>)}
   </div>
   {units.length>6&&<button type="button" className="mt-4 rounded-md border px-4 py-2 text-sm font-semibold" title={showAllUnits?'Plega el llistat a les sis primeres línies':'Mostra totes les línies identificades de l’annex'} onClick={()=>setShowAllUnits(value=>!value)}>{showAllUnits?'Mostra només les 6 primeres línies':`Mostra les ${units.length} línies`}</button>}
   {bulkEligible&&<div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4" data-testid="concert-bulk-review"><h4 className="font-semibold">Validar el repartiment complet</h4><p className="mt-1 text-sm">Comprova les {units.length} línies, els noms i els imports amb el PDF. Una única decisió aprovarà el conjunt; si falla una línia, no s’aprovarà cap.</p><label className="mt-3 block text-sm font-medium">Justificació de la validació<textarea className="form-text mt-1 w-full" rows={3} maxLength={1000} value={bulkNote} onChange={event=>setBulkNote(event.target.value)}/></label><button type="button" className="mt-3 rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy||!(showAllUnits||units.length<=6)||bulkNote.trim().length<10||units.some(unit=>!(editedNames[unit.id]??unit.provider_name??unit.observed_provider_name)?.trim())} onClick={()=>void reviewAll()}>{busy?'Validant…':`Aprovar les ${units.length} línies`}</button>{!showAllUnits&&units.length>6&&<p className="mt-2 text-xs">Mostra totes les línies abans de validar.</p>}</div>}
  </section>

  <section id="concert-history" aria-labelledby="history-title" className="min-w-0 scroll-mt-32 rounded-xl border border-violet-200 bg-violet-50/30 p-4 sm:p-5" data-testid="concert-history">
   <p className="page-eyebrow">02 · Evolució</p><h3 id="history-title" className="text-xl font-semibold">Resolució original i modificacions</h3>
   <p className="mt-1 text-sm text-muted-foreground">Una resolució pot repartir finançament entre diverses entitats i, alhora, tenir actes posteriors. El vincle entre publicacions no confirma encara l’efecte sobre cada línia.</p>
   {links.length?<div className="mt-4 grid gap-3">{links.map(link=><article key={link.id} className="min-w-0 rounded-lg border bg-white p-4 text-sm">
    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{link.direction==='anterior'?'Resolució anterior':'Canvi posterior'}</span>{linkCase[link.kind]&&<ConcertCaseBadge kind={linkCase[link.kind]}/>}<span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{link.status==='confirmed'?'Vincle confirmat':link.status==='candidate'?'Possible vincle · pendent de contrast':'Fora de la foto o descartat'}</span></div>
    {link.record&&<><a className="mt-2 block break-words font-medium underline" href={`/records/${link.record.id}#unitats`} title="Obre la fitxa de la resolució relacionada">{link.record.title}</a>{link.record.officialUrl&&<a className="mt-1 block break-all text-xs underline" href={link.record.officialUrl} target="_blank" rel="noopener noreferrer" title="Obre la publicació oficial relacionada">Publicació oficial · {link.record.sourceRecordId}</a>}</>}
    <p className="mt-2 text-xs text-muted-foreground">{link.evidence}</p>{link.reviewNote&&<p className="mt-1 text-xs">Revisió: {link.reviewNote}</p>}
   </article>)}</div>:<p className="mt-4 rounded-lg border bg-white p-4 text-sm">Encara no hi ha cap resolució anterior o posterior vinculada. Si l’acte modifica un concert previ, cal localitzar-lo i revisar les línies afectades.</p>}
  </section>

  <ConcertEconomics recordId={record.id}/>

  {units.some(u=>u.status==='approved')&&<p role="status" className="text-sm">L’Excel exporta les adjudicacions aprovades. L’exportació de foto i moviments aplica les modificacions revisades per període; no sumis aquesta foto amb l’Excel històric d’adjudicacions. La provisió global anterior es conserva a l’historial per evitar duplicar imports.</p>}
  {allowed?<details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold" title="Obre el formulari per afegir una línia acreditada de l’annex">Afegir una línia de l’annex</summary><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));void submit({unit:data});}}>
   {([['provider_name','Entitat beneficiària',true],['provider_nif','NIF',false],['centre','Centre',false],['period','Període acreditat',true]] as const).map(([name,label,required])=><label key={name}>{label}<input className="form-text mt-1 w-full" name={name} required={required} maxLength={300}/></label>)}
   <label>Servei de Cartera<select className="form-control mt-1 w-full" name="service_code" required><option value="">Selecciona el codi de l’annex</option>{services.map(s=><option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>
   <label>Tipus d’acte<select className="form-control mt-1 w-full" name="act_type"><option value="award">Adjudicació / concert</option><option value="renewal">Pròrroga</option><option value="amendment">Esmena</option><option value="modification">Modificació</option><option value="termination">Cessament</option><option value="cession">Cessió</option><option value="appeal">Recurs</option><option value="validation">Convalidació</option></select></label>
   <label>Import individual acreditat (€)<input className="form-text mt-1 w-full" type="number" step="0.01" name="amount"/></label>
   <label>Document<select className="form-control mt-1 w-full" name="document_id" required><option value="">Selecciona el document</option>{record.sourceDocuments.filter(d=>d.status==='fetched').map(d=><option key={d.id} value={d.id}>{sourceDocumentTypeLabel(d.documentType)} · {d.url}</option>)}</select></label>
   <label>Pàgina de l’annex<input className="form-text mt-1 w-full" type="number" name="page" min="1" required/></label>
   <label className="md:col-span-2">Cita literal de la fila i del codi de servei<textarea className="form-text mt-1 min-h-28 w-full" name="evidence_quote" minLength={20} maxLength={12000} required/></label>
   <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" title="Desa una nova línia pendent de revisió">{busy?'Guardant…':'Afegir unitat pendent de revisió'}</button>
  </form></details>:<p className="text-xs text-muted-foreground">Per afegir una línia nova manualment, cal validar el resultat del registre. Les línies extretes es revisen des de «Revisar línia».</p>}
  {error&&<p role="alert" className="status-error p-3">{error}</p>}
 </section>;
}

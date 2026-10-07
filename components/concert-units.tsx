"use client";
import {useEffect,useMemo,useState} from 'react';
import type {SourceRecord} from '@/lib/workbench-types';
import {sourceDocumentTypeLabel} from '@/lib/ui-labels';
import {concertCaseKeys,type ConcertCaseKey} from '@/lib/concerts/case-labels';
import {ConcertCaseBadge} from './concert-case-badge';

type Unit={id:string;pipeline_job_id:string|null;provider_name:string|null;observed_provider_name:string|null;provider_nif:string|null;centre:string|null;period:string|null;service_code:string|null;observed_service_code:string|null;observed_service_name:string|null;reses_code:string|null;territory:string|null;municipality:string|null;effective_start:string|null;effective_end:string|null;quantity:number|null;amount:number|null;status:string;evidence_quote:string|null;review_note:string|null;page:number|null;act_type:string;storage_path:string|null;extraction_origin:string|null;horizon_state:string|null};
type LinkedRecord={id:string;title:string;sourceRecordId:string;officialUrl:string|null;publishedAt:string|null};
type ConcertLink={id:string;direction:'anterior'|'posterior';kind:string;method:string;status:string;evidence:string;reviewNote:string|null;record:LinkedRecord|null};
const money=(value:number)=>new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(value);
const actCase:Record<string,ConcertCaseKey>={award:'award',renewal:'renewal',amendment:'amendment',modification:'modification',termination:'termination',cession:'cession',appeal:'appeal',validation:'validation'};
const linkCase:Record<string,ConcertCaseKey>={...actCase};

export function ConcertUnits({record,services}:{record:SourceRecord;services:Array<{code:string;name:string}>}){
 const [supported,setSupported]=useState(true);
 const [units,setUnits]=useState<Unit[]>([]);
 const [links,setLinks]=useState<ConcertLink[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [editingUnitId,setEditingUnitId]=useState<string|null>(null);
 const [showAllUnits,setShowAllUnits]=useState(false);
 const url=`/api/records/${record.id}/units`;
 useEffect(()=>{const c=new AbortController();fetch(url,{signal:c.signal}).then(r=>r.json()).then(data=>{if(data.error)setError(data.error);else{setSupported(data.supported!==false);setUnits(data.units??[]);}}).catch(e=>{if(e.name!=='AbortError')setError('No s’han pogut carregar les unitats');});return()=>c.abort();},[url]);
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
 const serviceByCode=useMemo(()=>new Map(services.map(service=>[service.code,service.name])),[services]);
 if(!supported)return <section id="unitats" className="surface p-5"><h2 className="section-title">Repartiment del concert</h2><p className="mt-2 text-sm">El desglossament per entitats està pendent d’activació en aquesta base de dades.</p></section>;
 const allowed=!record.isHistorical&&['approved','corrected'].includes(record.currentJobStatus??'');
 const expected=Number(record.title.match(/\b(\d+)\s+serveis\b/i)?.[1]);
 const knownExpected=Number.isInteger(expected)&&expected>0?expected:null;
 const represented=units.reduce((total,unit)=>total+(unit.quantity??1),0);
 const reviewed=units.filter(unit=>unit.status==='approved').length;
 const uniqueProviders=new Set(units.map(unit=>unit.provider_nif??unit.provider_name??unit.observed_provider_name).filter(Boolean)).size;
 const identifiedAmount=units.filter(unit=>unit.amount!=null).reduce((sum,unit)=>sum+Number(unit.amount),0);
 const pricedLines=units.filter(unit=>unit.amount!=null).length;
 const missingOlderOrigin=units.some(unit=>unit.horizon_state==='pre_2024_origin_unavailable');
 const caseKeys=concertCaseKeys(record.title,units.map(unit=>unit.act_type));
 const primary=caseKeys[0],attributes=caseKeys.slice(1);
 const visibleUnits=showAllUnits||units.length<=6?units:units.slice(0,6);
 const serviceGroups=new Map<string,{title:string;code:string|null;rows:Array<{unit:Unit;index:number}>}>();
 visibleUnits.forEach((unit,index)=>{
  const code=unit.service_code??unit.observed_service_code;
  const title=(code&&serviceByCode.get(code))??unit.observed_service_name??'Servei pendent de contrastar';
  const key=code??title;
  if(!serviceGroups.has(key))serviceGroups.set(key,{title,code,rows:[]});
  serviceGroups.get(key)!.rows.push({unit,index});
 });
 const orderedServiceGroups=[...serviceGroups.entries()].sort(([,left],[,right])=>
  Number(left.title==='Servei pendent de contrastar')-Number(right.title==='Servei pendent de contrastar')
 );
 return <section id="unitats" className="surface space-y-6 p-4 sm:p-6">
  <div>
   <p className="page-eyebrow">Concert social · lectura de l’expedient</p>
   <h2 className="section-title mt-1">Acte, repartiment i evolució</h2>
   <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">L’acte descriu què publica l’Administració. El repartiment mostra cada entitat i servei de l’annex. L’evolució agrupa les resolucions que poden canviar aquest concert. Les dades extretes continuen pendents de revisió individual.</p>
   <div className="mt-3 flex flex-wrap gap-2" aria-label="Casuístiques detectades pel títol i l’annex"><ConcertCaseBadge kind={primary}/>{attributes.map(kind=><ConcertCaseBadge key={kind} kind={kind}/>)}<span className="self-center text-xs text-muted-foreground">Lectura preliminar del títol; contrasta-la amb el PDF.</span></div>
   <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Navegació del concert"><a className="rounded-md border px-3 py-2 font-medium underline underline-offset-2" href="#concert-distribution">Veure repartiment per entitat</a><a className="rounded-md border px-3 py-2 font-medium underline underline-offset-2" href="#concert-history">Veure modificacions {links.length?`(${links.length})`:''}</a></nav>
  </div>

  <div className="grid gap-3 sm:grid-cols-3" data-testid="concert-coverage">
   <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línies de l’annex</p><p className="mt-1 text-2xl font-bold tabular-nums">{units.length}</p><p className="text-xs text-muted-foreground">{represented} serveis representats{knownExpected?` de ${knownExpected} anunciats`:''}</p></div>
   <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entitats identificades</p><p className="mt-1 text-2xl font-bold tabular-nums">{uniqueProviders}</p><p className="text-xs text-muted-foreground">Segons el NIF de cada línia; {reviewed} línies aprovades</p></div>
   <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-sky-900">Import de les línies identificades</p><p className="mt-1 text-2xl font-bold tabular-nums text-sky-950">{pricedLines?money(identifiedAmount):'No atribuïble'}</p><p className="text-xs text-sky-900">{pricedLines} de {units.length} línies amb import · encara no és el saldo vigent</p></div>
  </div>
  {missingOlderOrigin&&<p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">L’origen d’aquestes pròrrogues és anterior a 2024. Els imports repetits del document no s’atribueixen ni se sumen com a imports individuals.</p>}

  <section id="concert-distribution" className="scroll-mt-32" aria-labelledby="distribution-title" data-testid="concert-distribution">
   <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="page-eyebrow">01 · Distribució</p><h3 id="distribution-title" className="text-xl font-semibold">Entitats, serveis i imports</h3></div><p className="text-xs text-muted-foreground">Una fitxa per línia de l’annex · {units.length} línies</p></div>
   {!units.length&&<p className="mt-3 rounded-lg border p-4 text-sm">Aquest acte no té línies de repartiment verificades. Consulta l’evolució per veure la resolució relacionada.</p>}
   <div className="mt-4 grid gap-4">
    {orderedServiceGroups.map(([groupKey,group])=><section key={groupKey} className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 sm:p-4" data-testid="concert-service-group">
     <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servei de l’annex</p><h4 className="mt-1 break-words text-lg font-bold">{group.title}</h4>{group.code&&<p className="text-xs text-muted-foreground">Codi de Cartera observat: {group.code}</p>}</div><p className="text-xs text-muted-foreground">{group.rows.length} {group.rows.length===1?'línia visible':'línies visibles'}</p></div>
     <div className="mt-3 grid gap-3">
    {group.rows.map(({unit,index})=>{
     const entity=unit.provider_name??unit.observed_provider_name;
     const code=unit.service_code??unit.observed_service_code;
     const service=(code&&serviceByCode.get(code))??unit.observed_service_name;
     const act=actCase[unit.act_type];
     return <article key={unit.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5" data-testid="concert-unit">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]">
       <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línia {index+1} · Entitat</p><h5 className="mt-1 break-words text-lg font-bold leading-snug">{entity??'Nom de l’entitat pendent de verificar'}</h5>
        {entity&&!unit.provider_name&&<p className="mt-1 text-xs text-amber-800">Nom llegit a l’annex · pendent de validar</p>}
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servei</p><p className="mt-1 break-words text-base font-semibold">{service??'Nom del servei pendent de contrastar'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{code?`Codi de Cartera observat: ${code}`:'Codi de Cartera pendent'}{unit.reses_code?` · RESES ${unit.reses_code}`:''}</p>
       </div>
       <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 lg:text-right"><p className="text-xs font-semibold uppercase tracking-wide text-sky-900">Import individual</p><p className="mt-1 break-words text-2xl font-bold tabular-nums text-sky-950">{unit.amount==null?'No acreditat':money(Number(unit.amount))}</p><p className="mt-1 text-xs leading-5 text-sky-900">{unit.amount==null?'El PDF no permet atribuir un import segur a aquesta línia.':'Import de la línia segons l’annex; pendent de revisió.'}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
       {act&&<ConcertCaseBadge kind={act}/>}<span className="rounded-full border px-2.5 py-1">{unit.status==='approved'?'Línia aprovada':unit.status==='rejected'?'Línia rebutjada':'Pendent de revisió'}</span>
       {unit.provider_nif&&<span>NIF {unit.provider_nif}</span>}{unit.centre&&<span>Centre: {unit.centre}</span>}{(unit.municipality||unit.territory)&&<span>{unit.municipality??unit.territory}</span>}{unit.period&&<span>Període {unit.period}</span>}{unit.quantity&&<span>{unit.quantity} {unit.quantity===1?'servei':'serveis'}</span>}
      </div>
      <details className="mt-3 rounded-lg bg-muted/20 p-3 text-sm"><summary className="cursor-pointer font-medium" title="Mostra la cita de l’annex i la font arxivada">Evidència i traçabilitat · pàgina {unit.page??'pendent'}</summary>
       <blockquote className="mt-3 break-words whitespace-pre-wrap border-l-2 pl-3 leading-6">{unit.evidence_quote??'Cita pendent'}</blockquote><p className="mt-2 break-all text-xs">ID de la línia: {unit.id}</p>
       <p className="mt-2">{unit.storage_path?<a href={`${url}/${unit.id}/source`} target="_blank" rel="noopener noreferrer" className="underline" title="Obre el PDF oficial guardat per a aquesta línia">Obre la còpia arxivada</a>:'Font pendent d’arxivar a Storage'}</p>
       {unit.review_note&&<p className="mt-2">Revisió: {unit.review_note}</p>}
      </details>
      {allowed&&unit.status==='draft'&&unit.extraction_origin&&!unit.pipeline_job_id&&unit.observed_service_code&&<div className="mt-3"><button type="button" className="rounded border px-3 py-2 text-sm" title="Confirma el nom de l’entitat i el codi del servei abans de revisar la línia" onClick={()=>setEditingUnitId(editingUnitId===unit.id?null:unit.id)}>Completa la línia per revisar-la</button>
       {editingUnitId===unit.id&&<form className="mt-2 grid gap-2 rounded border p-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void submit({prepareExtractedUnitId:unit.id,providerName:form.get('provider_name'),serviceCode:unit.observed_service_code});}}><label>Nom complet de l’entitat segons el PDF<input className="form-text mt-1 w-full" name="provider_name" defaultValue={unit.observed_provider_name??''} minLength={3} required/></label><p className="text-sm">NIF {unit.provider_nif} · RESES {unit.reses_code} · codi {unit.observed_service_code}. Confirma el nom abans d’aprovar.</p><button className="rounded border px-3 py-2" title="Desa el nom contrastat; no aprova la línia" disabled={busy}>Desar identificació de la línia</button></form>}
      </div>}
      {allowed&&unit.status==='draft'&&(!unit.extraction_origin||unit.pipeline_job_id)&&<div className="mt-3 space-y-2"><label className="block">Justificació de la unitat<textarea className="form-text w-full" value={notes[unit.id]??''} onChange={e=>setNotes({...notes,[unit.id]:e.target.value})}/></label><div className="flex flex-wrap gap-2"><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="rounded border px-3 py-2 disabled:opacity-50" title="Aprova només aquesta línia després de contrastar la font" onClick={()=>void submit({unitId:unit.id,approve:true,note:notes[unit.id]})}>Aprovar unitat</button><button disabled={busy||(notes[unit.id]?.trim().length??0)<10} className="rounded border px-3 py-2 disabled:opacity-50" title="Rebutja només aquesta línia i conserva la justificació" onClick={()=>void submit({unitId:unit.id,approve:false,note:notes[unit.id]})}>Rebutjar unitat</button></div></div>}
     </article>;
    })}
     </div>
    </section>)}
   </div>
   {units.length>6&&<button type="button" className="mt-4 rounded-md border px-4 py-2 text-sm font-semibold" title={showAllUnits?'Plega el llistat a les sis primeres línies':'Mostra totes les línies identificades de l’annex'} onClick={()=>setShowAllUnits(value=>!value)}>{showAllUnits?'Mostra només les 6 primeres línies':`Mostra les ${units.length} línies`}</button>}
  </section>

  <section id="concert-history" aria-labelledby="history-title" className="scroll-mt-32 rounded-xl border border-violet-200 bg-violet-50/30 p-4 sm:p-5" data-testid="concert-history">
   <p className="page-eyebrow">02 · Evolució</p><h3 id="history-title" className="text-xl font-semibold">Resolució original i modificacions</h3>
   <p className="mt-1 text-sm text-muted-foreground">Una resolució pot repartir finançament entre diverses entitats i, alhora, tenir actes posteriors. El vincle entre publicacions no confirma encara l’efecte sobre cada línia.</p>
   {links.length?<div className="mt-4 grid gap-3">{links.map(link=><article key={link.id} className="rounded-lg border bg-white p-4 text-sm">
    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{link.direction==='anterior'?'Resolució anterior':'Canvi posterior'}</span>{linkCase[link.kind]&&<ConcertCaseBadge kind={linkCase[link.kind]}/>}<span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{link.status==='confirmed'?'Vincle confirmat':link.status==='candidate'?'Possible vincle · pendent de contrast':'Fora de la foto o descartat'}</span></div>
    {link.record&&<><a className="mt-2 block break-words font-medium underline" href={`/records/${link.record.id}#unitats`} title="Obre la fitxa de la resolució relacionada">{link.record.title}</a>{link.record.officialUrl&&<a className="mt-1 block break-all text-xs underline" href={link.record.officialUrl} target="_blank" rel="noopener noreferrer" title="Obre la publicació oficial relacionada">Publicació oficial · {link.record.sourceRecordId}</a>}</>}
    <p className="mt-2 text-xs text-muted-foreground">{link.evidence}</p>{link.reviewNote&&<p className="mt-1 text-xs">Revisió: {link.reviewNote}</p>}
   </article>)}</div>:<p className="mt-4 rounded-lg border bg-white p-4 text-sm">Encara no hi ha cap resolució anterior o posterior vinculada. Si l’acte modifica un concert previ, cal localitzar-lo i revisar les línies afectades.</p>}
  </section>

  {units.some(u=>u.status==='approved')&&<p role="status" className="text-sm">L’Excel exporta les adjudicacions aprovades. Una pròrroga, esmena, cessió o cessament revisat no es compta com una nova adjudicació. La provisió global anterior es conserva a l’historial per evitar duplicar imports.</p>}
  {allowed?<details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold" title="Obre el formulari per afegir una línia acreditada de l’annex">Afegir una línia de l’annex</summary><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));void submit({unit:data});}}>
   {([['provider_name','Entitat beneficiària',true],['provider_nif','NIF',false],['centre','Centre',false],['period','Període acreditat',true]] as const).map(([name,label,required])=><label key={name}>{label}<input className="form-text mt-1 w-full" name={name} required={required} maxLength={300}/></label>)}
   <label>Servei de Cartera<select className="form-control mt-1 w-full" name="service_code" required><option value="">Selecciona el codi de l’annex</option>{services.map(s=><option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>
   <label>Tipus d’acte<select className="form-control mt-1 w-full" name="act_type"><option value="award">Adjudicació / concert</option><option value="renewal">Pròrroga</option><option value="amendment">Esmena</option><option value="modification">Modificació</option><option value="termination">Cessament</option><option value="cession">Cessió</option><option value="appeal">Recurs</option><option value="validation">Convalidació</option></select></label>
   <label>Import individual acreditat (€)<input className="form-text mt-1 w-full" type="number" step="0.01" name="amount"/></label>
   <label>Document<select className="form-control mt-1 w-full" name="document_id" required><option value="">Selecciona el document</option>{record.sourceDocuments.filter(d=>d.status==='fetched').map(d=><option key={d.id} value={d.id}>{sourceDocumentTypeLabel(d.documentType)} · {d.url}</option>)}</select></label>
   <label>Pàgina de l’annex<input className="form-text mt-1 w-full" type="number" name="page" min="1" required/></label>
   <label className="md:col-span-2">Cita literal de la fila i del codi de servei<textarea className="form-text mt-1 min-h-28 w-full" name="evidence_quote" minLength={20} maxLength={12000} required/></label>
   <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" title="Desa una nova línia pendent de revisió">{busy?'Guardant…':'Afegir unitat pendent de revisió'}</button>
  </form></details>:<p className="text-sm">Valida primer el resultat del registre vigent per poder desglossar les transaccions acreditades.</p>}
  {error&&<p role="alert" className="status-error p-3">{error}</p>}
 </section>;
}

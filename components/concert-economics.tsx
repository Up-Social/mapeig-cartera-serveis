'use client';
import {useEffect,useState} from 'react';
import type {ConcertEvolutionData,EconomicUnit,EconomicReview} from '@/lib/concerts/evolution';
import {euroCents,ECONOMIC_AMOUNT_LABELS,type concertEvolution} from '@/lib/concerts/evolution';
import {concertUnitName,concertLineHref,concertPredecessorIds} from '@/lib/concerts/display-name';
import {PendingChecks} from './pending-checks';
import {DocumentViewer} from './document-viewer';
type Result={data:ConcertEvolutionData;projection:ReturnType<typeof concertEvolution>};
const money=(cents:number|null)=>cents===null?'No calculable':new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(cents/100);
const operations={award:'Import inicial',renewal:'Pròrroga · nou període',delta:'Increment o reducció',replacement:'Nou total que substitueix l’anterior',correction:'Rectificació d’un acte anterior',nonfinancial:'Sense nou efecte econòmic'};
const stateLabels={reviewed:'Revisat',pending:'Pendent',excluded:'Exclòs'};
export function ConcertEconomics({recordId}:{recordId:string}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cutoff,setCutoff]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[selectedLink,setSelectedLink]=useState<string|null>(null),[notes,setNotes]=useState<Record<string,string>>({});
 const [mode,setMode]=useState<'links'|'effects'|'history'>('links'),[filter,setFilter]=useState(''),[limit,setLimit]=useState(6);
 const [search,setSearch]=useState(''),[matches,setMatches]=useState<Array<Partial<EconomicUnit>&{id:string}>>([]);
 const endpoint=`/api/records/${recordId}/concert-economics`;
 useEffect(()=>{const c=new AbortController();fetch(`${endpoint}${cutoff?`?cutoff=${cutoff}`:''}`,{cache:'no-store',signal:c.signal}).then(async r=>{
  const value=await r.json();if(!r.ok)throw Error(value.error);setResult(value);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[endpoint,cutoff]);
 useEffect(()=>{function focus(){const hash=window.location.hash;if(hash.startsWith('#concert-link-')){setSelectedLink(hash.slice(14));setMode('links');}if(hash.startsWith('#concert-effect-')){setSelected(hash.slice(16));setMode('effects');}}
  focus();window.addEventListener('hashchange',focus);return()=>window.removeEventListener('hashchange',focus);},[]);
 useEffect(()=>{const target=selectedLink?`concert-link-${selectedLink}`:selected?`concert-effect-${selected}`:null;if(target&&result){const frame=requestAnimationFrame(()=>document.getElementById(target)?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(frame);}},[selectedLink,selected,result,mode]);
 async function send(body:Record<string,unknown>,targetRecordId=recordId){
  setBusy(true);setError('');try{
   const response=await fetch(`/api/records/${targetRecordId}/concert-economics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   const value=await response.json();if(!response.ok)throw Error(value.error);
   const fresh=await fetch(`${endpoint}${cutoff?`?cutoff=${cutoff}`:''}`,{cache:'no-store'});const next=await fresh.json();if(!fresh.ok)throw Error(next.error);
   setResult(next);setSelected(null);setSelectedLink(null);
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut desar la revisió');}finally{setBusy(false);}
 }
 const data=result?.data,projection=result?.projection;
 const units=new Map(data?.units.map(u=>[u.id,u])??[]);
 const current=data?.units.filter(u=>u.source_record_id===recordId)??[];
 const unit=selected?units.get(selected):undefined;
 const review=unit?data?.reviews.find(r=>r.unit_id===unit.id):undefined;
 const textMatches=(value:string)=>value.toLocaleLowerCase('ca').includes(filter.toLocaleLowerCase('ca'));
 const visibleLinks=(data?.links??[]).filter(l=>{const a=units.get(l.later_unit_id),b=units.get(l.earlier_unit_id);return a&&b&&textMatches(`${concertUnitName(a)} ${concertUnitName(b)} ${a.reses_code} ${a.provider_nif} ${a.observed_service_code} ${l.evidence}`);});
 const visibleUnits=current.filter(u=>textMatches(`${concertUnitName(u)} ${u.reses_code} ${u.provider_nif} ${u.service_code??u.observed_service_code}`));
 const activeLink=data?.links.find(l=>l.id===selectedLink);
 return <section id="concert-economics" className="min-w-0 scroll-mt-32 rounded-xl border border-teal-200 bg-teal-50/20 p-4 sm:p-5" data-testid="concert-economics">
  <p className="page-eyebrow">03 · Vincles i imports</p><h3 className="text-xl font-semibold">Vincles i saldo del concert</h3>
  <p className="mt-2 text-sm">1. Revisa el repartiment. 2. Confirma els vincles amb les resolucions anteriors. 3. Revisa què canvia en cada import. El saldo només incorpora dades acreditades des de 2024.</p>
  {error&&<p role="alert" className="mt-3 rounded border border-red-300 p-3 text-red-900">{error}</p>}
  {!result&&!error&&<p className="mt-3" role="status">Carregant vincles i imports…</p>}
  {projection&&<>
   <div className="mt-4 rounded-lg border bg-white p-4"><h4 className="font-semibold">Saldo acreditat</h4><p className="mt-1 text-sm" role="status">{projection.balances.length===0?'Encara no calculable: cal completar les revisions. L’import de l’annex es conserva al repartiment.':'Els saldos amb impediments es mostren com a no calculables.'} {projection.pending} moviments pendents · {projection.excluded} exclosos.</p>
   <div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-0 text-sm">Foto a data de<input type="date" className="form-text mt-1 block max-w-full" value={cutoff||projection.cutoff} onChange={e=>setCutoff(e.target.value)}/></label><a className="rounded border px-3 py-2 text-sm underline" href={`/api/exports/concerts?record=${recordId}&cutoff=${cutoff||projection.cutoff}`}>Exportar foto i moviments</a></div>
   {projection.balances.map((b,index)=><article key={index} className="mt-3 rounded border p-3"><h4 className="break-words font-semibold">{b.provider}</h4><p className="break-words text-sm">{b.service} · {b.territory} · {b.period} · {b.funder}</p><p className="mt-2 text-2xl font-bold">{money(b.amountCents)}{b.maximum?' · màxim autoritzat':''}</p><PendingChecks issues={b.issues}/></article>)}</div>
   {projection.missingLines.map(m=><p key={`${m.later_record_id}:${m.earlier_record_id}`} className="mt-3 rounded border border-amber-300 p-3 text-sm">Falta el desglossament d’una <a className="underline" href={`/records/${m.later_record_id}#unitats`}>publicació relacionada</a>. El seu efecte continua pendent.</p>)}
   <nav className="mt-5 flex flex-wrap gap-2" aria-label="Revisió de vincles i imports">{([['links',`Vincles (${data?.links.length??0})`],['effects',`Efectes per línia (${current.length})`],['history',`Historial (${projection.movements.length})`]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={mode===key} className={`rounded-md border px-3 py-2 text-sm font-semibold ${mode===key?'bg-neutral-900 text-white':'bg-white'}`} onClick={()=>{setMode(key);setLimit(6);setFilter('');}}>{label}</button>)}</nav>
   {mode!=='history'&&<label className="mt-4 block text-sm font-medium">Cercar entitat, NIF, RESES o servei<input className="form-text mt-1 block w-full" value={filter} onChange={e=>{setFilter(e.target.value);setLimit(6);}}/></label>}
   {mode==='links'&&<div className="mt-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Revisa cada proposta comparant les dues línies amb els seus PDF.</p><button className="rounded border bg-white px-3 py-2 text-sm" disabled={busy} title="Crea propostes; no confirma vincles ni modifica imports" onClick={()=>void send({action:'discover'})}>{busy?'Treballant…':'Cercar nous vincles'}</button></div>
    {!visibleLinks.length&&<p className="rounded border bg-white p-4 text-sm">No hi ha vincles per mostrar. Un concert inicial pot no tenir modificacions; una pròrroga necessita localitzar l’original.</p>}
    {visibleLinks.filter((l,i)=>i<limit||l.id===selectedLink).map(link=>{
     const later=units.get(link.later_unit_id)!,earlier=units.get(link.earlier_unit_id)!;
     const open=activeLink?.id===link.id,canConfirm=later.status==='approved'&&earlier.status==='approved';
     return <article id={`concert-link-${link.id}`} key={link.id} className="min-w-0 scroll-mt-32 rounded-xl border bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-muted-foreground">RESES {later.reses_code??'pendent'} · {later.service_code??later.observed_service_code??'Servei pendent'}</p><h4 className="mt-1 break-words text-base font-bold">{concertUnitName(later)}</h4><p className="mt-1">{link.status==='confirmed'?'Vincle confirmat':link.status==='candidate'?'Proposta pendent de revisió':'Vincle descartat o fora de l’horitzó'}</p></div><button type="button" aria-expanded={open} aria-controls={`link-review-${link.id}`} className="rounded-md border px-3 py-2 font-semibold" onClick={()=>setSelectedLink(open?null:link.id)}>{open?'Tancar revisió':'Revisar aquest vincle'}</button></div>
      {open&&<div id={`link-review-${link.id}`} className="mt-4 space-y-4"><div className="grid gap-3 lg:grid-cols-2">{([[earlier,'Resolució anterior'],[later,'Resolució posterior']] as const).map(([u,label])=><div key={u.id} className="min-w-0 rounded-lg border bg-neutral-50 p-3"><p className="font-semibold">{label}</p><p className="mt-1 break-words font-bold">{concertUnitName(u)}</p>{u.recovered_provider_name&&<p className="text-xs text-amber-900">Nom recuperat del mateix PDF · pendent de validar</p>}<p className="mt-1 break-words">Servei {u.service_code??u.observed_service_code??'pendent'} · RESES {u.reses_code} · NIF {u.provider_nif}</p><p>Període: {u.period??'pendent'} · Import de l’annex: {u.amount==null?'no acreditat':money(euroCents(u.amount))}</p><a className="mt-2 inline-block underline" href={concertLineHref(u.source_record_id,u.id)}>Anar a aquesta línia</a><DocumentViewer url={`/api/records/${u.source_record_id}/units/${u.id}/source`} page={u.page??1} label={`Comprovar PDF · pàgina ${u.page??1}`}/></div>)}</div>
       <p className="break-words rounded border p-3">Motiu de la proposta: {link.evidence}</p>
       {!canConfirm&&<p className="rounded border border-amber-300 bg-amber-50 p-3">Per confirmar el vincle, cal validar abans les línies de les dues resolucions. Pots contrastar-les ara; l’aprovació conjunta de l’annex es manté.</p>}
       <label className="block font-medium">Justificació del vincle<textarea className="form-text mt-1 w-full" value={notes[link.id]??''} onChange={e=>setNotes({...notes,[link.id]:e.target.value})}/></label>
       <div className="flex flex-wrap gap-2">{([['confirmed','Confirmar vincle'],['rejected','Rebutjar proposta'],['out_of_horizon','Original anterior a 2024']] as const).map(([status,label])=><button key={status} className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy||(notes[link.id]?.trim().length??0)<10||(status==='confirmed'&&!canConfirm)} title={status==='confirmed'?'Requereix les dues línies aprovades i una cadena completa fins a l’original':'Conserva la justificació sense aplicar el vincle al saldo'} onClick={()=>void send({action:'link',linkId:link.id,unitId:later.id,version:link.version,fingerprint:later.source_fingerprint,earlierFingerprint:earlier.source_fingerprint,status,note:notes[link.id]},later.source_record_id)}>{label}</button>)}</div><p className="text-xs text-muted-foreground">Cal una justificació d’almenys 10 caràcters. Confirmar el vincle no confirma l’import.</p>
      </div>}
     </article>;
    })}
    {visibleLinks.length>limit&&<button className="rounded border px-3 py-2 text-sm" onClick={()=>setLimit(n=>n+12)}>Mostrar més vincles ({Math.min(limit,visibleLinks.length)} de {visibleLinks.length})</button>}
   </div>}
   {mode==='effects'&&<div className="mt-4 space-y-3"><p className="text-sm">Revisa una línia cada vegada. Desar una proposta econòmica no aprova el repartiment.</p>
    {!visibleUnits.length&&<p>No hi ha línies amb aquests criteris.</p>}
    {visibleUnits.filter((u,i)=>i<limit||u.id===selected).map(u=>{const m=projection.movements.find(m=>m.unitId===u.id);return <article id={`concert-effect-${u.id}`} key={u.id} className="scroll-mt-32 rounded border bg-white p-4 text-sm"><h4 className="break-words font-bold">{concertUnitName(u)}</h4><p>RESES {u.reses_code} · Servei {u.service_code??u.observed_service_code??'pendent'}</p><p>{m?stateLabels[m.status]:'Línia rebutjada'} · {m?.operation&&m.operation!=='pending'?operations[m.operation as keyof typeof operations]:'Efecte per determinar'}</p><button className="mt-2 rounded border px-3 py-2 font-semibold" onClick={()=>setSelected(selected===u.id?null:u.id)}>{selected===u.id?'Tancar revisió':'Revisar import i període'}</button>
     {selected===u.id&&<div className="mt-3"><PendingChecks issues={m?.issues??[]}/><DocumentViewer url={`/api/records/${u.source_record_id}/units/${u.id}/source`} page={u.page??1} label="Comprovar PDF de la línia"/><EconomicForm key={`${u.id}:${review?.version??0}`} unit={u} review={review} data={data!} busy={busy} onSave={value=>void send({action:'economics',unitId:u.id,version:review?.version??0,fingerprint:u.source_fingerprint,expectedJobId:data?.publications.find(p=>p.id===recordId)?.job_id,value})}/></div>}</article>;})}
    {visibleUnits.length>limit&&<button className="rounded border px-3 py-2" onClick={()=>setLimit(n=>n+12)}>Mostrar més línies</button>}
   </div>}
   {mode==='history'&&<ol className="mt-4 space-y-3">{projection.movements.map(m=><li key={m.unitId} className="rounded border bg-white p-3 text-sm"><h4 className="break-words font-semibold">{m.provider}</h4><p>{m.operation==='pending'?'Efecte pendent':operations[m.operation as keyof typeof operations]} · {m.period} · {stateLabels[m.status]}</p><p className="mt-2 font-semibold">{m.operation==='nonfinancial'?'Sense nou import':`Import del moviment: ${money(m.amountCents)}`}</p>{m.operation!=='nonfinancial'&&<p className="text-xs">{ECONOMIC_AMOUNT_LABELS[m.amountKind]}</p>}{m.beforeCents!==undefined&&<p>Saldo abans: {money(m.beforeCents)} · després: {money(m.afterCents??null)}</p>}<a className="underline" href={concertLineHref(m.recordId,m.unitId)}>Veure aquesta línia</a><PendingChecks issues={m.issues}/></li>)}</ol>}
   {unit&&mode==='effects'&&<details className="mt-4 rounded border bg-white p-4"><summary className="cursor-pointer font-semibold">No hi ha el vincle? Proposar un original documentat</summary><div className="mt-3 flex flex-wrap gap-2"><label>Cerca per entitat, NIF o RESES<input className="form-text mt-1 block" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="rounded border px-3 py-2" disabled={search.trim().length<3||busy} onClick={()=>{void fetch(`${endpoint}?search=${encodeURIComponent(search)}`,{cache:'no-store'}).then(r=>r.json()).then(v=>{if(v.error)setError(v.error);else setMatches(v.units);}).catch(()=>setError('No s’ha pogut cercar'));}}>Cercar originals</button></div><form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send({action:'propose',unitId:unit.id,version:0,fingerprint:unit.source_fingerprint,earlierId:f.get('earlier'),evidence:f.get('quote')});}}><label className="block">Línia anterior<select name="earlier" className="form-control mt-1 w-full" required><option value="">Selecciona un resultat</option>{matches.map(u=><option key={u.id} value={u.id}>{concertUnitName(u)} · {u.reses_code} · {u.period}</option>)}</select></label><label className="block">Cita literal que relaciona els actes<textarea name="quote" className="form-text mt-1 w-full" minLength={20} required/></label><button disabled={busy||!matches.length} className="rounded border px-3 py-2">Desar proposta de vincle</button></form></details>}
  </>}
 </section>;
}
function EconomicForm({unit,review,data,busy,onSave}:{unit:EconomicUnit;review:EconomicReview|undefined;data:ConcertEvolutionData;busy:boolean;onSave:(value:Record<string,unknown>)=>void}){
 const [error,setError]=useState('');
 const [operation,setOperation]=useState(review?.operation??'');
 const preceding=concertPredecessorIds(unit.id,data.links);
 return <form className="mt-3 grid min-w-0 gap-3 rounded-lg border bg-white p-4 [&>label]:min-w-0 [&_select]:max-w-full sm:grid-cols-2" onSubmit={e=>{
  e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));
  const raw=String(values.amount??'').trim(),cents=euroCents(raw);if(raw&&cents===null){setError('Import no vàlid: màxim dos decimals.');return;}
  const annualities=[];
  for(const line of String(values.annualitiesText??'').split('\n').filter(l=>l.trim())){const m=line.trim().match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\s*=\s*(.+)$/);const amount=m?euroCents(m[3]):null;if(!m||amount===null){setError('Anualitat no vàlida: inici/final = euros, una per línia.');return;}annualities.push({start:m[1],end:m[2],amountCents:amount});}
  setError('');onSave({...values,annualities,amount_cents:cents,corrects_unit_id:values.corrects_unit_id||null});
 }}>
  <h4 className="break-words font-semibold sm:col-span-2">Significat de l’import · {concertUnitName(unit)}</h4>
  <label>Operació<select name="operation" className="form-control mt-1 w-full" required value={operation} onChange={e=>setOperation(e.target.value as typeof operation)}><option value="">Selecciona l’efecte acreditat</option>{Object.entries(operations).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label>Import del moviment (€)<input name="amount" type="text" inputMode="decimal" className="form-text mt-1 w-full" defaultValue={review?.amount_cents!=null?(review.amount_cents/100).toFixed(2):''}/><span className="text-xs">Negatiu per reduccions; en blanc si no consta. No introdueixis el total anterior com a increment.</span></label>
  <label>Tipus d’import<select name="amount_kind" defaultValue={review?.amount_kind??'unknown'} className="form-control mt-1 w-full"><option value="unknown">No acreditat</option><option value="exact">Import acreditat</option><option value="maximum">Màxim autoritzat</option></select></label>
  <label>Òrgan finançador<input name="funder" className="form-text mt-1 w-full" defaultValue={review?.funder??''}/></label>
  {([['period_start','Inici del període',review?.period_start],['period_end','Final del període',review?.period_end],['effective_at','Data d’efectes',review?.effective_at]] as const).map(([key,label,value])=><label key={key}>{label}<input type="date" name={key} className="form-text mt-1 w-full" defaultValue={value??''}/></label>)}
  {operation==='correction'&&<label>Acte anterior que rectifica<select name="corrects_unit_id" defaultValue={review?.corrects_unit_id??''} className="form-control mt-1 w-full"><option value="">Cap</option>{data.units.filter(u=>preceding.has(u.id)||u.id===review?.corrects_unit_id).map(u=><option key={u.id} value={u.id}>{concertUnitName(u)} · {u.reses_code} · {u.act_type} · {u.id.slice(0,8)}</option>)}</select><span className="text-xs">Només les línies de la cadena proposada o confirmada. Si falta l’acte, proposa primer el vincle.</span></label>}
  {['award','renewal'].includes(operation)&&<label className="sm:col-span-2">Anualitats explícites (opcional)<textarea name="annualitiesText" className="form-text mt-1 w-full" placeholder="2025-10-01/2025-12-31 = 110585.79" defaultValue={review?.annualities?.map(a=>`${a.start}/${a.end} = ${(a.amountCents/100).toFixed(2)}`).join('\n')??''}/><span className="text-xs">Només el desglossament acreditat al document. La suma ha de coincidir amb l’import total; sense desglossament no s’anualitza.</span></label>}
  <label className="sm:col-span-2">Cita literal que acredita import, període i efecte<textarea name="evidence_quote" className="form-text mt-1 min-h-24 w-full" required minLength={20} defaultValue={review?.evidence_quote??unit.evidence_quote??''}/></label>
  <label className="sm:col-span-2">Justificació de la interpretació<textarea name="review_note" className="form-text mt-1 w-full" required minLength={10} defaultValue={review?.review_note??''}/></label>
  <label>Decisió<select name="status" className="form-control mt-1 w-full" defaultValue="draft"><option value="draft">Desar proposta pendent</option><option value="approved">Confirmar després del contrast</option><option value="excluded">Excloure de la foto (amb justificació)</option></select></label>
  <button type="submit" disabled={busy} className="self-end rounded border px-3 py-2 font-semibold">Desar revisió econòmica</button>{error&&<p role="alert" className="text-red-900 sm:col-span-2">{error}</p>}
 </form>;
}

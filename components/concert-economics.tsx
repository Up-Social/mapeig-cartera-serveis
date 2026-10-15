'use client';
import {useEffect,useState} from 'react';
import type {ConcertEvolutionData,EconomicUnit,EconomicReview} from '@/lib/concerts/evolution';
import {euroCents,ECONOMIC_AMOUNT_LABELS,type concertEvolution} from '@/lib/concerts/evolution';
type Result={data:ConcertEvolutionData;projection:ReturnType<typeof concertEvolution>};
const money=(cents:number|null)=>cents===null?'No calculable':new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(cents/100);
const operations={award:'Import inicial',renewal:'Pròrroga · nou període',delta:'Increment o reducció',replacement:'Nou total que substitueix l’anterior',correction:'Rectificació d’un acte anterior',nonfinancial:'Sense nou efecte econòmic'};
const stateLabels={reviewed:'Revisat',pending:'Pendent',excluded:'Exclòs'};
export function ConcertEconomics({recordId}:{recordId:string}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cutoff,setCutoff]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[notes,setNotes]=useState<Record<string,string>>({});
 const [search,setSearch]=useState(''),[matches,setMatches]=useState<Array<Partial<EconomicUnit>&{id:string}>>([]);
 const endpoint=`/api/records/${recordId}/concert-economics`;
 useEffect(()=>{const c=new AbortController();fetch(`${endpoint}${cutoff?`?cutoff=${cutoff}`:''}`,{cache:'no-store',signal:c.signal}).then(async r=>{
  const value=await r.json();if(!r.ok)throw Error(value.error);setResult(value);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[endpoint,cutoff]);
 async function send(body:Record<string,unknown>){
  setBusy(true);setError('');try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   const value=await response.json();if(!response.ok)throw Error(value.error);
   const fresh=await fetch(`${endpoint}${cutoff?`?cutoff=${cutoff}`:''}`,{cache:'no-store'});const next=await fresh.json();if(!fresh.ok)throw Error(next.error);
   setResult(next);setSelected(null);
  }catch(e){setError(e instanceof Error?e.message:'No s’ha pogut desar la revisió');}finally{setBusy(false);}
 }
 const data=result?.data,projection=result?.projection;
 const units=new Map(data?.units.map(u=>[u.id,u])??[]);
 const current=data?.units.filter(u=>u.source_record_id===recordId)??[];
 const unit=selected?units.get(selected):undefined;
 const review=unit?data?.reviews.find(r=>r.unit_id===unit.id):undefined;
 return <section id="concert-economics" className="scroll-mt-32 rounded-xl border border-teal-200 bg-teal-50/20 p-4 sm:p-5" data-testid="concert-economics">
  <p className="page-eyebrow">03 · Vincles i imports</p><h3 className="text-xl font-semibold">Evolució econòmica del concert</h3>
  <p className="mt-2 text-sm">Horitzó des de 2024. El saldo exigeix línies validades, vincles confirmats i imports acreditats per període. Les publicacions originals i els canvis es conserven.</p>
  <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Foto a data de<input type="date" className="form-text ml-2" value={cutoff||projection?.cutoff||''} onChange={e=>setCutoff(e.target.value)}/></label>
   <button className="rounded border px-3 py-2 text-sm" disabled={busy} title="Busca coincidències per referència i RESES + NIF. Només crea propostes; no confirma ni altera imports." onClick={()=>void send({action:'discover'})}>{busy?'Treballant…':'Cercar vincles amb altres concerts'}</button>
   {projection&&<a className="rounded border px-3 py-2 text-sm underline" href={`/api/exports/concerts?record=${recordId}&cutoff=${cutoff||projection.cutoff}`} title="Exporta la mateixa foto i, en una altra pestanya, els moviments i els pendents. No s’han de sumar les dues pestanyes.">Exportar foto i moviments</a>}
  </div>
  {error&&<p role="alert" className="mt-3 rounded border border-red-300 p-3 text-red-900">{error}</p>}
  {!result&&!error&&<p className="mt-3" role="status">Carregant vincles i imports…</p>}
  {projection&&<>
   <p role="status" className="mt-4 rounded border bg-white p-3 text-sm">{projection.pending} línies pendents de revisió econòmica · {projection.excluded} excloses de la foto. {projection.balances.length===0?'Encara no hi ha cap saldo acreditat. L’import llegit de l’annex no és un saldo validat.':'Els saldos amb impediments es mostren com a no calculables.'}</p>
   {projection.missingLines.map(m=><p key={`${m.later_record_id}:${m.earlier_record_id}`} className="mt-3 rounded border border-amber-300 p-3 text-sm">Hi ha una <a className="underline" href={`/records/${m.later_record_id}#unitats`}>publicació relacionada sense línies contrastades</a>. El seu efecte no es pot donar per resolt.</p>)}
   <div className="mt-3 grid gap-3">{projection.balances.map((b,index)=><article key={index} className="rounded-lg border bg-white p-4"><h4 className="font-semibold">{b.provider} · {b.service}</h4><p className="text-sm">{b.territory} · {b.period} · {b.funder}</p><p className="mt-2 text-2xl font-bold">{money(b.amountCents)}{b.maximum?' · màxim autoritzat':''}</p><p className="text-xs text-muted-foreground">Entitat vigent a la data de tall. Consolidat per NIF, servei, territori, període i finançador. L’historial conserva els titulars anteriors.</p>{b.issues.map(issue=><p className="mt-1 text-sm text-amber-900" key={issue}>{issue}</p>)}</article>)}</div>
   {projection.movements.length>0&&<details className="mt-4 rounded border bg-white p-3"><summary className="cursor-pointer font-semibold">Historial econòmic i modificacions ({projection.movements.length})</summary><ol className="mt-3 space-y-3">{projection.movements.map(m=><li key={m.unitId} className="rounded border p-3 text-sm"><h4 className="font-semibold">{m.provider} · {m.operation==='pending'?'Efecte pendent':operations[m.operation as keyof typeof operations]}</h4><p>{m.effectiveAt??'Data d’efectes pendent'} · {m.period} · {stateLabels[m.status]}</p><p className="mt-2 font-semibold">{m.operation==='nonfinancial'?'Sense nou import':`Import del moviment: ${money(m.amountCents)}`}</p>{m.operation!=='nonfinancial'&&<p className="text-xs">{ECONOMIC_AMOUNT_LABELS[m.amountKind]}{m.status==='pending'?' · interpretació pendent de validació':''}</p>}{m.beforeCents!==undefined&&<p>Saldo abans: {money(m.beforeCents)} · saldo després: {money(m.afterCents??null)}</p>}<a className="mt-2 inline-block underline" href={`/records/${m.recordId}#unitats`}>Veure la resolució i el PDF</a>{m.issues.map(issue=><p key={issue} className="mt-1 text-amber-900">{issue}</p>)}</li>)}</ol></details>}
   <details className="mt-4 rounded border bg-white p-3"><summary className="cursor-pointer font-semibold">Revisar línies i efectes econòmics ({current.length})</summary>
    {!current.length&&<p className="mt-2 text-sm">Falten línies documentals. Completa el desglossament amb la font abans de vincular o calcular imports.</p>}
    {current.map(u=>{
     const m=projection.movements.find(m=>m.unitId===u.id);
     return <article key={u.id} className="mt-3 rounded border p-3 text-sm"><h4 className="font-semibold">{u.provider_name??u.observed_provider_name??'Entitat pendent'} · {u.reses_code??'RESES pendent'} · {u.service_code??u.observed_service_code??'Servei pendent'}</h4>
      <p>{m?stateLabels[m.status]:'Línia rebutjada'} · {m?.operation&&m.operation!=='pending'?operations[m.operation as keyof typeof operations]:'Efecte per determinar'} · {m?.period}</p>
      {m?.issues.map(issue=><p key={issue} className="mt-1 text-amber-900">{issue}</p>)}
      <div className="mt-2 flex flex-wrap gap-3"><a className="underline" href={`/api/records/${u.source_record_id}/units/${u.id}/source`} target="_blank" rel="noopener noreferrer" title="Obre la còpia arxivada per contrastar la línia i el període">PDF de la línia · p. {u.page??'?'}</a><button className="rounded border px-3 py-1" title="Desa una interpretació o revisa-la després d’aprovar el resultat i les línies" onClick={()=>setSelected(selected===u.id?null:u.id)}>Revisar l’efecte econòmic</button></div>
     </article>;
    })}
   </details>
   {unit&&<details className="mt-3 rounded border bg-white p-4"><summary className="cursor-pointer font-semibold">Proposar un original o un acte anterior citat al PDF</summary>
    <div className="mt-3 flex flex-wrap gap-2"><label>Cerca per entitat, NIF o RESES<input className="form-text ml-2" value={search} onChange={e=>setSearch(e.target.value)}/></label><button type="button" className="rounded border px-3 py-2" disabled={search.trim().length<3||busy} onClick={()=>{void fetch(`${endpoint}?search=${encodeURIComponent(search)}`,{cache:'no-store'}).then(r=>r.json()).then(v=>{if(v.error)setError(v.error);else setMatches(v.units);}).catch(()=>setError('No s’ha pogut cercar'));}}>Cercar originals</button></div>
    <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send({action:'propose',unitId:unit.id,version:0,fingerprint:unit.source_fingerprint,earlierId:f.get('earlier'),evidence:f.get('quote')});}}>
     <label className="block">Línia anterior<select name="earlier" className="form-control mt-1 w-full" required><option value="">Selecciona entre els resultats de la cerca</option>{matches.map(u=><option key={u.id} value={u.id}>{u.provider_name??u.observed_provider_name??'Nom pendent'} · {u.reses_code} · {u.service_code??u.observed_service_code} · {u.period??'Període pendent'} · {u.act_type} · {u.id.slice(0,8)}</option>)}</select></label>
     <label className="block">Cita literal que relaciona els actes<textarea name="quote" className="form-text mt-1 w-full" minLength={20} required/></label><button disabled={busy||!matches.length} className="rounded border px-3 py-2">Desar proposta de vincle</button><p className="text-xs">La proposta no confirma la relació ni modifica el saldo. En trasllats, contrasta els establiments d’origen i destí.</p>
    </form>
   </details>}
   {unit&&<EconomicForm key={`${unit.id}:${review?.version??0}`} unit={unit} review={review} data={data!} busy={busy} onSave={value=>void send({action:'economics',unitId:unit.id,version:review?.version??0,fingerprint:unit.source_fingerprint,expectedJobId:data?.publications.find(p=>p.id===recordId)?.job_id,value})}/>}
   <div className="mt-4 space-y-3">{data?.links.map(link=>{
    const later=units.get(link.later_unit_id),earlier=units.get(link.earlier_unit_id);if(!later||!earlier)return null;
    const canReview=later.source_record_id===recordId;
    return <article key={link.id} className="rounded border bg-white p-4 text-sm"><h4 className="font-semibold">{later.provider_name??later.observed_provider_name??'Entitat pendent'} · {later.reses_code} → {earlier.provider_name??earlier.observed_provider_name??'Origen pendent'} · {earlier.reses_code}</h4>
     <p className="mt-1 font-medium">{link.status==='confirmed'?'Vincle confirmat':link.status==='candidate'?'Vincle proposat · cal revisar-lo':'Vincle descartat o fora de l’horitzó'}</p><p className="mt-2">{link.evidence}</p>
     <div className="mt-2 flex gap-4"><a href={`/records/${earlier.source_record_id}#unitats`} className="underline">Resolució anterior</a><a href={`/records/${later.source_record_id}#unitats`} className="underline">Resolució posterior</a></div>
     {canReview&&<><label className="mt-3 block">Justificació del vincle<textarea className="form-text mt-1 w-full" value={notes[link.id]??''} onChange={e=>setNotes({...notes,[link.id]:e.target.value})}/></label><div className="mt-2 flex flex-wrap gap-2">{([['confirmed','Confirmar vincle'],['rejected','Rebutjar vincle'],['out_of_horizon','Fora de l’horitzó']] as const).map(([status,label])=><button key={status} className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy||(notes[link.id]?.trim().length??0)<10} title={status==='confirmed'?'Comprova la cadena completa. Cal que totes les línies estiguin aprovades.':'Conserva el vincle i la justificació, sense aplicar-lo al saldo.'} onClick={()=>void send({action:'link',linkId:link.id,unitId:later.id,version:link.version,fingerprint:later.source_fingerprint,earlierFingerprint:earlier.source_fingerprint,status,note:notes[link.id]})}>{label}</button>)}</div></>}
    </article>;
   })}</div>
  </>}
 </section>;
}
function EconomicForm({unit,review,data,busy,onSave}:{unit:EconomicUnit;review:EconomicReview|undefined;data:ConcertEvolutionData;busy:boolean;onSave:(value:Record<string,unknown>)=>void}){
 const [error,setError]=useState('');
 return <form className="mt-3 grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2" onSubmit={e=>{
  e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));
  const raw=String(values.amount??'').trim(),cents=euroCents(raw);if(raw&&cents===null){setError('Import no vàlid: màxim dos decimals.');return;}
  const annualities=[];
  for(const line of String(values.annualitiesText??'').split('\n').filter(l=>l.trim())){const m=line.trim().match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\s*=\s*(.+)$/);const amount=m?euroCents(m[3]):null;if(!m||amount===null){setError('Anualitat no vàlida: inici/final = euros, una per línia.');return;}annualities.push({start:m[1],end:m[2],amountCents:amount});}
  setError('');onSave({...values,annualities,amount_cents:cents,corrects_unit_id:values.corrects_unit_id||null});
 }}>
  <h4 className="font-semibold sm:col-span-2">Significat de l’import · {unit.provider_name??unit.observed_provider_name}</h4>
  <label>Operació<select name="operation" className="form-control mt-1 w-full" required defaultValue={review?.operation??''}><option value="">Selecciona l’efecte acreditat</option>{Object.entries(operations).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label>Import del moviment (€)<input name="amount" type="text" inputMode="decimal" className="form-text mt-1 w-full" defaultValue={review?.amount_cents!=null?(review.amount_cents/100).toFixed(2):''}/><span className="text-xs">Negatiu per reduccions; en blanc si no consta. No introdueixis el total anterior com a increment.</span></label>
  <label>Tipus d’import<select name="amount_kind" defaultValue={review?.amount_kind??'unknown'} className="form-control mt-1 w-full"><option value="unknown">No acreditat</option><option value="exact">Import acreditat</option><option value="maximum">Màxim autoritzat</option></select></label>
  <label>Òrgan finançador<input name="funder" className="form-text mt-1 w-full" defaultValue={review?.funder??''}/></label>
  {([['period_start','Inici del període',review?.period_start],['period_end','Final del període',review?.period_end],['effective_at','Data d’efectes',review?.effective_at]] as const).map(([key,label,value])=><label key={key}>{label}<input type="date" name={key} className="form-text mt-1 w-full" defaultValue={value??''}/></label>)}
  <label>Acte que rectifica (només esmenes)<select name="corrects_unit_id" defaultValue={review?.corrects_unit_id??''} className="form-control mt-1 w-full"><option value="">Cap</option>{data.units.filter(u=>u.id!==unit.id).map(u=><option key={u.id} value={u.id}>{u.provider_name??u.observed_provider_name} · {u.reses_code} · {u.act_type} · {u.id.slice(0,8)}</option>)}</select></label>
  <label className="sm:col-span-2">Anualitats explícites (opcional)<textarea name="annualitiesText" className="form-text mt-1 w-full" placeholder="2025-10-01/2025-12-31 = 110585.79" defaultValue={review?.annualities?.map(a=>`${a.start}/${a.end} = ${(a.amountCents/100).toFixed(2)}`).join('\n')??''}/><span className="text-xs">Només el desglossament acreditat al document. La suma ha de coincidir amb l’import total; sense desglossament no s’anualitza.</span></label>
  <label className="sm:col-span-2">Cita literal que acredita import, període i efecte<textarea name="evidence_quote" className="form-text mt-1 min-h-24 w-full" required minLength={20} defaultValue={review?.evidence_quote??unit.evidence_quote??''}/></label>
  <label className="sm:col-span-2">Justificació de la interpretació<textarea name="review_note" className="form-text mt-1 w-full" required minLength={10} defaultValue={review?.review_note??''}/></label>
  <label>Decisió<select name="status" className="form-control mt-1 w-full" defaultValue="draft"><option value="draft">Desar proposta pendent</option><option value="approved">Confirmar després del contrast</option><option value="excluded">Excloure de la foto (amb justificació)</option></select></label>
  <button type="submit" disabled={busy} className="self-end rounded border px-3 py-2 font-semibold">Desar revisió econòmica</button>{error&&<p role="alert" className="text-red-900 sm:col-span-2">{error}</p>}
 </form>;
}

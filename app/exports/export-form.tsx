'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState,useTransition,type FormEvent} from 'react';
import {FilterForm} from '@/components/filter-form';
import type {FinancingType} from '@/lib/financing-types';
import type {MapeigPreview} from '@/lib/exports/mapeig';
import {mapeigFiltersToSearchParams} from '@/lib/exports/mapeig/filters';
import {periodLabel,provincesLabel,typesLabel} from '@/lib/exports/mapeig/labels';
import {MAPEIG_AVAILABLE_TYPES,MAPEIG_PROVINCES,MAPEIG_TYPE_LABELS,type MapeigExportRecord,type MapeigFilters} from '@/lib/exports/mapeig/types';

const money=(cents:number)=>new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(cents/100);
const count=(value:number)=>value.toLocaleString('ca-ES');
const when=(iso:string)=>new Date(iso).toLocaleString('ca-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'});
const TYPE_ORDER:FinancingType[]=['concert','subvencio','conveni','contractacio'];
type Props={filters:MapeigFilters;years:number[];applied:boolean;filterError:string|null;preview:MapeigPreview|null;previewError:string|null;history:MapeigExportRecord[];historyError:string|null};

export function ExportForm({filters,years,applied,filterError,preview,previewError,history,historyError}:Props){
 const router=useRouter();
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 // Applying filters re-renders the page on the server, which reads every line
 // to compute the summary; the transition keeps the form responsive and shows
 // that the records are being analysed until the new summary arrives.
 const [analysing,startAnalysing]=useTransition();
 function applyFilters(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const params=new URLSearchParams([...new FormData(event.currentTarget).entries()].map(([key,value])=>[key,String(value)]));
  setMessage('');setError('');
  startAnalysing(()=>router.push(`/exports?${params.toString()}`));
 }
 const canDownload=!!preview&&preview.rowCount>0&&!preview.tooManyRows;
 async function download(){
  if(busy||!canDownload)return;
  setBusy(true);setMessage('');setError('');
  try{
   const response=await fetch(`/api/exports/mapeig?${mapeigFiltersToSearchParams(filters)}`,{cache:'no-store'});
   if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error??'No s’ha pogut generar l’Excel.');}
   const blob=await response.blob();
   const name=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]??'Mapeig-Cartera.xlsx';
   const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();URL.revokeObjectURL(url);
   const saved=response.headers.get('X-Export-History')!=='unavailable';
   setMessage(saved?`Excel generat: ${name}. Queda a l’històric.`:`Excel generat: ${name}. No s’ha pogut desar a l’històric; el fitxer descarregat és correcte.`);
   router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'Error d’exportació.');}
  finally{setBusy(false);}
 }
 const warnings=preview?[
  preview.counts.withoutCode?`${count(preview.counts.withoutCode)} línies sense codi de la Cartera. S’exporten igualment i queden marcades a Detall_Registres.`:null,
  preview.counts.withoutDate?`${count(preview.counts.withoutDate)} línies sense data de concessió. S’exporten igualment; no entren al filtre d’anys.`:null,
  preview.counts.withoutProvince?`${count(preview.counts.withoutProvince)} línies sense província. S’exporten igualment i consten com a «Sense província» al resum.`:null,
  preview.counts.withoutAmount?`${count(preview.counts.withoutAmount)} línies sense import. S’exporten amb l’import en blanc.`:null,
  preview.counts.withoutOrgan?`${count(preview.counts.withoutOrgan)} línies amb l’òrgan buit o no reconegut per les paraules clau del resum (fila de control 164).`:null,
  preview.counts.unlistedCode?`${count(preview.counts.unlistedCode)} línies amb un codi que no és a la Taula (resum); si el catàleg oficial el coneix, s’afegeix a les files grogues.`:null,
  preview.excluded.province?`${count(preview.excluded.province)} línies excloses pel filtre de província.`:null,
  preview.excluded.dateRange?`${count(preview.excluded.dateRange)} línies excloses pel filtre d’anys de concessió.`:null,
 ].filter((text):text is string=>!!text):[];
 return <>
  <FilterForm className="surface grid gap-4 p-4" onSubmit={applyFilters} aria-busy={analysing}>
   <input type="hidden" name="applied" value="1"/>
   <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Tipologia</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{TYPE_ORDER.map(type=>{const available=MAPEIG_AVAILABLE_TYPES.includes(type);return <label key={type} className={`flex items-center gap-2 text-sm ${available?'':'text-muted-foreground'}`}><input type="checkbox" name="type" value={type} className="size-4" defaultChecked={filters.financingTypes.includes(type)} disabled={!available}/>{MAPEIG_TYPE_LABELS[type]}{!available&&<span className="rounded border px-1.5 py-0.5 text-xs">Properament</span>}</label>;})}</div>
    <p className="text-xs text-muted-foreground">Es poden exportar els Concerts (totes les línies: pendents, aprovades i rebutjades) i els Convenis (propostes pendents de revisió i línies aprovades, dins i fora de la Cartera). L’estat de revisió consta a les columnes addicionals. Subvencions i contractacions s’afegiran més endavant.</p>
   </fieldset>
   <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Província</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{MAPEIG_PROVINCES.map(province=><label key={province} className="flex items-center gap-2 text-sm"><input type="checkbox" name="province" value={province} className="size-4" defaultChecked={!!filters.provinces?.includes(province)}/>{province}</label>)}</div>
    <p className="text-xs text-muted-foreground">Sense cap província marcada s’exporten totes. Les línies sense província no es filtren: s’exporten i s’avisen.</p>
   </fieldset>
   <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Any de concessió</legend>
    <div className="grid gap-3 md:grid-cols-[220px_220px_auto]">
     <label className="grid gap-1 text-sm">Des de<select className="form-text" name="from" defaultValue={filters.yearFrom??''}><option value="">Sense límit</option>{years.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Fins a<select className="form-text" name="to" defaultValue={filters.yearTo??''}><option value="">Sense límit</option>{years.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
     <div className="flex items-end gap-3"><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={analysing}>{analysing?'Analitzant…':'Aplicar filtres'}</button>{applied&&!analysing&&<Link className="self-center text-sm underline" href="/exports">Netejar filtres</Link>}</div>
    </div>
    <p className="text-xs text-muted-foreground">Els dos límits són inclusius i opcionals. Les línies sense data de concessió no es filtren: s’exporten i s’avisen.</p>
   </fieldset>
  </FilterForm>
  {analysing&&<section role="status" aria-live="polite" className="surface space-y-3 p-4">
   <p className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"/>Analitzant els registres per calcular el resum de l’exportació…</p>
   <p className="text-xs text-muted-foreground">Es llegeixen totes les línies que compleixen els filtres (imports, codis, dates i territoris). Pot trigar uns segons; quan acabi apareixerà el resum i el botó «Generar Excel».</p>
   <div className="h-6 w-2/3 animate-pulse rounded bg-muted"/><div className="h-24 animate-pulse rounded bg-muted"/>
  </section>}
  {!analysing&&filterError&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{filterError}</p>}
  {!analysing&&previewError&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{previewError}</p>}
  {!applied&&!analysing&&<p className="text-sm text-muted-foreground">Aplica els filtres per veure quantes línies entrarien al fitxer abans de generar-lo.</p>}
  {preview&&!analysing&&<section className="surface space-y-3 p-4">
   <h2 className="font-semibold">Resum de l’exportació</h2>
   {preview.rowCount===0?<p className="text-sm">No hi ha cap línia que compleixi aquests filtres. Amplia les províncies o el període.</p>:<>
    <p className="text-sm"><span className="font-medium">{count(preview.rowCount)} línies</span> entrarien al fitxer · Import total: <span className="font-medium">{money(preview.totalCents)}</span></p>
    <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-1">Província</th><th className="py-1 text-right">Línies</th><th className="py-1 text-right">Import</th></tr></thead>
     <tbody>{preview.byProvince.map(item=><tr key={item.province??'none'} className="border-t"><td className="py-1">{item.province??'Sense província'}</td><td className="py-1 text-right tabular-nums">{count(item.rows)}</td><td className="py-1 text-right tabular-nums">{money(item.amountCents)}</td></tr>)}</tbody></table>
   </>}
   {warnings.length>0&&<ul role="status" className="status-warning space-y-1 rounded-md border p-3 text-sm">{warnings.map(text=><li key={text}>{text}</li>)}</ul>}
   {preview.tooManyRows&&<p role="alert" className="status-error rounded-md border p-3 text-sm">L’exportació supera el màxim de {count(preview.maxRows)} línies. Acota per província o per anys.</p>}
   {preview.notes.length>0&&<details className="text-sm"><summary className="cursor-pointer">Notes que s’inclouran al fitxer</summary><ul className="mt-2 list-disc space-y-1 pl-5">{preview.notes.map(note=><li key={note}>{note}</li>)}</ul></details>}
   <div className="flex flex-wrap items-center gap-3">
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!canDownload||busy} onClick={()=>void download()}>{busy?'Generant…':'Generar Excel'}</button>
    <span className="text-xs text-muted-foreground">El fitxer conté els fulls Instruccions, Taula (resum), Detall_Registres, Llistes_Auxiliars i Notes_Exportacio. No modifica cap dada.</span>
   </div>
   {message&&<p role="status" className="status-success rounded-md border p-3 text-sm">{message}</p>}
   {error&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{error}</p>}
  </section>}
  <section className="surface space-y-3 p-4">
   <h2 className="font-semibold">Històric d’exportacions</h2>
   {historyError&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{historyError}</p>}
   {!historyError&&history.length===0&&<p className="text-sm text-muted-foreground">Encara no s’ha generat cap fitxer. Cada Excel generat quedarà aquí amb la data d’exportació i es podrà tornar a descarregar tal com es va generar.</p>}
   {history.length>0&&<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-1 pr-3">Data d’exportació</th><th className="py-1 pr-3">Tipologies</th><th className="py-1 pr-3">Territori</th><th className="py-1 pr-3">Anys</th><th className="py-1 pr-3 text-right">Línies</th><th className="py-1 pr-3 text-right">Import</th><th className="py-1">Fitxer</th></tr></thead>
    <tbody>{history.map(item=><tr key={item.id} className="border-t align-top">
     <td className="py-1 pr-3 whitespace-nowrap"><time dateTime={item.createdAt}>{when(item.createdAt)}</time></td>
     <td className="py-1 pr-3">{typesLabel(item.financingTypes)}</td>
     <td className="py-1 pr-3">{provincesLabel(item.provinces)}</td>
     <td className="py-1 pr-3 whitespace-nowrap">{periodLabel(item)}</td>
     <td className="py-1 pr-3 text-right tabular-nums">{count(item.rowCount)}</td>
     <td className="py-1 pr-3 text-right tabular-nums whitespace-nowrap">{money(item.totalCents)}</td>
     <td className="py-1"><a className="underline break-all" href={`/api/exports/mapeig/${item.id}`}>{item.fileName}</a>{item.note&&<p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}</td>
    </tr>)}</tbody></table></div>}
  </section>
 </>;
}

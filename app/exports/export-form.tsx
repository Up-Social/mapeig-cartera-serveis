'use client';
import Link from 'next/link';
import {useState} from 'react';
import {FilterForm} from '@/components/filter-form';
import type {FinancingType} from '@/lib/financing-types';
import type {MapeigPreview} from '@/lib/exports/mapeig';
import {mapeigFiltersToSearchParams} from '@/lib/exports/mapeig/filters';
import {MAPEIG_AVAILABLE_TYPES,MAPEIG_PROVINCES,MAPEIG_TYPE_LABELS,type MapeigFilters} from '@/lib/exports/mapeig/types';

const money=(cents:number)=>new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(cents/100);
const count=(value:number)=>value.toLocaleString('ca-ES');
const TYPE_ORDER:FinancingType[]=['concert','subvencio','conveni','contractacio'];

export function ExportForm({filters,applied,filterError,preview,previewError}:{filters:MapeigFilters;applied:boolean;filterError:string|null;preview:MapeigPreview|null;previewError:string|null}){
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
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
   setMessage(`Excel generat: ${name}`);
  }catch(cause){setError(cause instanceof Error?cause.message:'Error d’exportació.');}
  finally{setBusy(false);}
 }
 const warnings=preview?[
  preview.counts.withoutCode?`${count(preview.counts.withoutCode)} línies sense codi de la Cartera. S’exporten igualment i queden marcades a Detall_Registres.`:null,
  preview.counts.withoutDate?`${count(preview.counts.withoutDate)} línies sense data de concessió. S’exporten igualment; no entren al filtre de dates.`:null,
  preview.counts.withoutProvince?`${count(preview.counts.withoutProvince)} línies sense província. S’exporten igualment i consten com a «Sense província» al resum.`:null,
  preview.counts.withoutAmount?`${count(preview.counts.withoutAmount)} línies sense import. S’exporten amb l’import en blanc.`:null,
  preview.counts.withoutOrgan?`${count(preview.counts.withoutOrgan)} línies amb l’òrgan buit o no reconegut per les paraules clau del resum (fila de control 164).`:null,
  preview.counts.unlistedCode?`${count(preview.counts.unlistedCode)} línies amb un codi que no és a la Taula (resum); si el catàleg oficial el coneix, s’afegeix a les files grogues.`:null,
  preview.excluded.province?`${count(preview.excluded.province)} línies excloses pel filtre de província.`:null,
  preview.excluded.dateRange?`${count(preview.excluded.dateRange)} línies excloses pel filtre de data de concessió.`:null,
 ].filter((text):text is string=>!!text):[];
 return <>
  <FilterForm className="surface grid gap-4 p-4">
   <input type="hidden" name="applied" value="1"/>
   <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Tipologia</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{TYPE_ORDER.map(type=>{const available=MAPEIG_AVAILABLE_TYPES.includes(type);return <label key={type} className={`flex items-center gap-2 text-sm ${available?'':'text-muted-foreground'}`}><input type="checkbox" name="type" value={type} className="size-4" defaultChecked={filters.financingTypes.includes(type)} disabled={!available}/>{MAPEIG_TYPE_LABELS[type]}{!available&&<span className="rounded border px-1.5 py-0.5 text-xs">Properament</span>}</label>;})}</div>
    <p className="text-xs text-muted-foreground">En aquesta fase només s’exporten els Concerts, amb totes les seves línies (pendents, aprovades i rebutjades) i l’estat de revisió a les columnes addicionals. Les altres tipologies s’afegiran més endavant.</p>
   </fieldset>
   <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Província</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{MAPEIG_PROVINCES.map(province=><label key={province} className="flex items-center gap-2 text-sm"><input type="checkbox" name="province" value={province} className="size-4" defaultChecked={!!filters.provinces?.includes(province)}/>{province}</label>)}</div>
    <p className="text-xs text-muted-foreground">Sense cap província marcada s’exporten totes. Les línies sense província no es filtren: s’exporten i s’avisen.</p>
   </fieldset>
   <div className="grid gap-3 md:grid-cols-[220px_220px_auto]">
    <input className="form-text" type="date" name="from" aria-label="Data de concessió des de" defaultValue={filters.awardDateFrom??''}/>
    <input className="form-text" type="date" name="to" aria-label="Data de concessió fins a" defaultValue={filters.awardDateTo??''}/>
    <div className="flex items-end gap-3"><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Aplicar filtres</button>{applied&&<Link className="self-center text-sm underline" href="/exports">Netejar filtres</Link>}</div>
   </div>
  </FilterForm>
  {filterError&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{filterError}</p>}
  {previewError&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{previewError}</p>}
  {!applied&&<p className="text-sm text-muted-foreground">Aplica els filtres per veure quantes línies entrarien al fitxer abans de generar-lo.</p>}
  {preview&&<section className="surface space-y-3 p-4">
   <h2 className="font-semibold">Resum de l’exportació</h2>
   {preview.rowCount===0?<p className="text-sm">No hi ha cap línia que compleixi aquests filtres. Amplia les províncies o el període.</p>:<>
    <p className="text-sm"><span className="font-medium">{count(preview.rowCount)} línies</span> entrarien al fitxer · Import total: <span className="font-medium">{money(preview.totalCents)}</span></p>
    <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-1">Província</th><th className="py-1 text-right">Línies</th><th className="py-1 text-right">Import</th></tr></thead>
     <tbody>{preview.byProvince.map(item=><tr key={item.province??'none'} className="border-t"><td className="py-1">{item.province??'Sense província'}</td><td className="py-1 text-right tabular-nums">{count(item.rows)}</td><td className="py-1 text-right tabular-nums">{money(item.amountCents)}</td></tr>)}</tbody></table>
   </>}
   {warnings.length>0&&<ul role="status" className="status-warning space-y-1 rounded-md border p-3 text-sm">{warnings.map(text=><li key={text}>{text}</li>)}</ul>}
   {preview.tooManyRows&&<p role="alert" className="status-error rounded-md border p-3 text-sm">L’exportació supera el màxim de {count(preview.maxRows)} línies. Acota per província o per dates.</p>}
   {preview.notes.length>0&&<details className="text-sm"><summary className="cursor-pointer">Notes que s’inclouran al fitxer</summary><ul className="mt-2 list-disc space-y-1 pl-5">{preview.notes.map(note=><li key={note}>{note}</li>)}</ul></details>}
   <div className="flex flex-wrap items-center gap-3">
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!canDownload||busy} onClick={()=>void download()}>{busy?'Generant…':'Generar Excel'}</button>
    <span className="text-xs text-muted-foreground">El fitxer conté els fulls Instruccions, Taula (resum), Detall_Registres, Llistes_Auxiliars i Notes_Exportacio. No modifica cap dada.</span>
   </div>
   {message&&<p role="status" className="status-success rounded-md border p-3 text-sm">{message}</p>}
   {error&&<p role="alert" className="status-error rounded-md border p-3 text-sm">{error}</p>}
  </section>}
 </>;
}

import type {SourceRecord} from '@/lib/workbench-types';
import {assessConcertAct,CONCERT_CASE_LABELS,type ConcertEffect} from '@/lib/concerts/act-assessment';

function display(value:string|number|null|undefined){return value==null||value===''?'No consta':String(value);}
const EFFECT_LABELS:Record<ConcertEffect,string>={none:'sense nou finançament acreditat',possible_award:'possible adjudicació',possible_reduction:'possible reducció',possible_delta:'possible diferència',possible_new_period:'possible compromís d’un període nou',possible_correction:'possible correcció',possible_maximum:'possible import màxim',possible_allocation:'possible repartiment plurianual',provisional:'provisional'};

export function CaseAtAGlance({record}:{record:SourceRecord}){
 const assessment=record.financingType==='concert'?assessConcertAct(record.title,record.sourceDocuments.find(d=>d.status==='fetched'&&d.extractedText&&!d.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag)))?.extractedText):null;
 const extracted=record.externalEnrichment;
 const rows=[
  {label:'Entitat',original:record.providerName,official:extracted?.providerName},
  {label:'Import',original:record.amount,official:extracted?.amount},
  {label:'Mecanisme',original:record.mechanism,official:extracted?.mechanism},
 ].filter(row=>row.original!=null||row.official!=null);
 return <section id="resum" aria-label="Resum del cas" className="surface scroll-mt-32 p-5 sm:p-6">
  <p className="page-eyebrow">Lectura ràpida</p><h2 className="section-title mt-1">Resum del cas</h2>
  <p className="mt-2 text-sm text-muted-foreground">Dades de la font i camps extrets del document. Les diferències requereixen comprovació humana.</p>
  <dl className="mt-4 grid gap-3 text-sm lg:grid-cols-3">{rows.map(row=>{
    const compared=extracted&&row.official!=null;
    const differs=compared&&display(row.original)!==display(row.official);
    return <div key={row.label} className="rounded-lg border p-3"><dt className="font-semibold">{row.label}</dt><dd className="mt-1">Font: {display(row.original)}</dd>{compared&&<dd className={`mt-1 ${differs?'font-medium text-amber-800':''}`}>Document: {display(row.official)}{differs?' · diferència pendent de revisar':''}</dd>}</div>;
  })}</dl>
  {assessment&&<div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-slate-900" data-testid="concert-assessment" data-effect={assessment.effect}>
   <h3 className="font-semibold">Cribratge del concert · cas {assessment.primaryCase??'pendent'}</h3>
   <p className="mt-1">{assessment.primaryCase?CONCERT_CASE_LABELS[assessment.primaryCase]:'Tipus d’acte pendent d’identificar'}{assessment.overlappingCases.length?` · també ${assessment.overlappingCases.map(value=>`${value}. ${CONCERT_CASE_LABELS[value]}`).join(', ')}`:''}</p>
   <p className="mt-2">{assessment.reason}</p>
   <p className="mt-2 text-xs">Base: {assessment.source==='document'?'text del document':assessment.source==='title'?'títol de la publicació':'sense text'} · Efecte proposat: {EFFECT_LABELS[assessment.effect]} · Sempre pendent de revisió. No genera cap import automàtic.</p>
   <p className="mt-2 text-xs">La validació general del servei no confirma l’efecte econòmic net d’aquest acte. Cal reconciliar els actes i les línies abans de considerar un total del concert.</p>
  </div>}
 </section>;
}

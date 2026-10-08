'use client';

import {useEffect,useState} from 'react';
import {formatAiCost,type EuroReferenceRate} from '@/lib/currency';
import type {AiCostSummary} from '@/lib/records-page';

type CostState={summary:AiCostSummary[];rate:EuroReferenceRate|null};

export function AiCostPanel({initialSummary,initialRate}:{initialSummary:AiCostSummary[];initialRate:EuroReferenceRate|null}){
  const [costs,setCosts]=useState<CostState>({summary:initialSummary,rate:initialRate});
  const [refreshError,setRefreshError]=useState(false);
  const [lastRefresh,setLastRefresh]=useState<string|null>(null);

  useEffect(()=>{
    let stopped=false;
    let running=false;
    let timer:number|undefined;
    let controller:AbortController|undefined;
    const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>void refresh(),30_000);};
    const refresh=async()=>{
      if(stopped||running)return;
      if(document.hidden){schedule();return;}
      running=true;
      controller=new AbortController();
      try{
        const response=await fetch('/api/admin/ai-cost',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('cost unavailable');
        const next=await response.json() as CostState;
        if(!Array.isArray(next.summary))throw Error('invalid cost response');
        if(!stopped){setCosts(next);setLastRefresh(new Date().toISOString());setRefreshError(false);}
      }catch{
        if(!stopped&&!controller.signal.aborted)setRefreshError(true);
      }finally{
        running=false;
        controller=undefined;
        if(!stopped)schedule();
      }
    };
    const onVisible=()=>{
      if(document.hidden)return;
      if(timer)window.clearTimeout(timer);
      void refresh();
    };
    schedule();
    document.addEventListener('visibilitychange',onVisible);
    return()=>{stopped=true;if(timer)window.clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',onVisible);};
  },[]);

  const totalUsd=costs.summary.reduce((sum,item)=>sum+item.totalUsd,0);
  const measuredRecords=costs.summary.reduce((sum,item)=>sum+item.measuredRecords,0);
  const pendingUsd=costs.summary.reduce((sum,item)=>sum+item.pendingReservedUsd,0);
  const unsettledCalls=costs.summary.reduce((sum,item)=>sum+item.unsettledCalls,0);
  const hasUsage=measuredRecords>0;
  return <section className="surface p-5" aria-labelledby="ai-cost-title" data-testid="ai-cost-summary">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="ai-cost-title" className="text-lg font-semibold">Despesa de processament amb IA</h2>
        <p className="mt-1 text-sm text-muted-foreground">Consum acumulat de les crides amb tokens confirmats. La mitjana es recalcula quan un procés o lot afegeix ús mesurat.</p></div>
      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">{lastRefresh?`Actualitzat a les ${new Intl.DateTimeFormat('ca-ES',{timeStyle:'medium',timeZone:'Europe/Madrid'}).format(new Date(lastRefresh))}`:'Actualització automàtica · 30 s'}</span>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border bg-muted/20 p-4"><p className="text-sm font-semibold">Cost acumulat calculat</p>
        <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="ai-total-cost">{hasUsage?formatAiCost(totalUsd,costs.rate):'Sense dades'}</p>
        <p className="mt-1 text-xs text-muted-foreground">{measuredRecords} registres amb consum mesurat · concerts i altres tipologies</p></div>
      <div className="rounded-lg border bg-muted/20 p-4"><p className="text-sm font-semibold">Mitjana per registre processat</p>
        <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="ai-average-cost">{hasUsage?formatAiCost(totalUsd/measuredRecords,costs.rate):'Sense dades'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Cost acumulat dividit entre els registres amb ús confirmat</p></div>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(['concert','altres'] as const).map(scope=>{
        const cost=costs.summary.find(item=>item.scope===scope);
        return <div key={scope} className="rounded-lg border p-4" data-testid={`ai-cost-${scope}`}>
          <h3 className="text-sm font-semibold">{scope==='concert'?'Concerts':'Altres tipologies'}</h3>
          <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Cost ja processat</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.measuredRecords?formatAiCost(cost.totalUsd,costs.rate):'Sense dades'}</dd></div>
            <div><dt className="text-muted-foreground">Mitjana per registre</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.measuredRecords?formatAiCost(cost.averageUsd,costs.rate):'Sense dades'}</dd></div>
            <div><dt className="text-muted-foreground">Registres amb consum</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.measuredRecords??0}</dd></div>
            <div><dt className="text-muted-foreground">D’aquests, revisats</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.reviewedRecords??0}</dd></div>
            <div><dt className="text-muted-foreground">Execucions amb cost</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.runsWithCost??0}</dd></div>
            <div><dt className="text-muted-foreground">Crides d’IA mesurades</dt><dd className="mt-1 font-semibold tabular-nums">{cost?.measuredCalls??0}</dd></div>
          </dl>
        </div>;
      })}
    </div>
    {unsettledCalls>0&&<p className="mt-3 rounded-lg border p-3 text-sm">{unsettledCalls} crides encara sense ús confirmat · reserva màxima pendent: {formatAiCost(pendingUsd,costs.rate)}. Aquesta reserva no se suma a la despesa.</p>}
    <p className="mt-3 text-xs text-muted-foreground">{costs.rate?`Equivalència en euros amb el canvi de referència del BCE del ${new Intl.DateTimeFormat('ca-ES',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${costs.rate.date}T00:00:00Z`))}: 1 € = ${costs.rate.usdPerEuro} USD.`:'El canvi del BCE no està disponible; es mostra el cost original en USD fins que es pugui convertir.'} Les xifres provenen dels tokens registrats i de la tarifa configurada; no són la factura del proveïdor. La revisió humana, l’OCR local i la infraestructura no hi estan inclosos.</p>
    {refreshError&&<p className="mt-2 text-xs text-muted-foreground" role="status">No s’ha pogut actualitzar ara; es mantenen les darreres xifres i es tornarà a provar.</p>}
  </section>;
}

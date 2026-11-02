'use client';
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {historicalFeatureUnavailable,historicalProcessingPaused} from '@/lib/concerts/historical-status-ui';

type HistoryStatus={state:string;reason?:string|null;can_start:boolean;feature_enabled?:boolean;processing_enabled?:boolean;pages_saved?:number;pages_total?:number|null;records_saved?:number|null;records_total?:number|null;phase?:string|null};
const labels:Record<string,string>={not_started:'No iniciada',starting:'Iniciant la recuperació',running:'Recuperació en curs',completed:'Recuperació finalitzada',stopping:'Aturant la recuperació',review_required:'Cal revisar la recuperació',disabled:'Recuperació no disponible',unavailable:'No es pot consultar l’estat'};
export function ConcertHistorySetting(){
 const [status,setStatus]=useState<HistoryStatus|null>(null);const [busy,setBusy]=useState(false);const [accepted,setAccepted]=useState(false);const [message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  try {const response=await fetch('/api/admin/settings/concert-history',{cache:'no-store'});const data=await response.json() as HistoryStatus;setStatus(data);}
  catch {setStatus({state:'unavailable',can_start:false});}
 },[]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0);const timer=['starting','running','stopping'].includes(status?.state??'')?setInterval(()=>void refresh(),5000):undefined;return ()=>{clearTimeout(initial);if(timer)clearInterval(timer);};},[refresh,status?.state]);
 async function begin(){
  if(!accepted||!status?.can_start||busy)return;
  setBusy(true);setMessage('');
  try {
   const response=await fetch('/api/admin/settings/concert-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});
   const data=await response.json() as {status?:string;error?:string};
   if(!response.ok)throw Error(data.error??'No s’ha pogut confirmar l’inici. Revisa l’estat abans de tornar a actuar.');
   setMessage('La recuperació s’ha iniciat. Pots tancar aquesta pàgina: el progrés queda desat.');
  } catch(error){setMessage(error instanceof Error?error.message:'No s’ha pogut confirmar l’inici. Cal revisar-ne l’estat.');}
  finally {await refresh();setBusy(false);}
 }
 return <section className="surface p-5 space-y-3" aria-labelledby="concert-history-title" aria-busy={busy}>
  <h2 id="concert-history-title" className="font-semibold">Ampliar els concerts des de 2020</h2>
  <p className="text-sm leading-6 text-muted-foreground">La cerca afegeix anuncis de concerts de 2020 a 2023 sense modificar els registres existents. La font pública pot no conservar tots els anuncis: completar la cerca no garanteix que el seu històric sigui exhaustiu.</p>
  <p role="status" className="text-sm font-medium">{status?labels[status.state]??'Cal revisar la recuperació':'Consultant l’estat…'}</p>
  {status?.pages_saved!=null&&<p className="text-sm">Pàgines desades: {status.pages_saved}{status.pages_total!=null?` de ${status.pages_total}`:''}{status.records_saved!=null?` · Registres incorporats o ja existents: ${status.records_saved}${status.records_total!=null?` de ${status.records_total}`:''}`:''}</p>}
  {status&&historicalFeatureUnavailable(status)&&<p className="text-sm">Aquesta opció encara no està disponible en aquest entorn.</p>}
  {status&&historicalProcessingPaused(status)&&<p className="text-sm">El processament està aturat. Cal activar-lo abans d’iniciar la recuperació.</p>}
  {status?.state==='review_required'&&<p className="text-sm">No s’ha pogut confirmar una operació. Es conserva el progrés, però la recuperació no es reprendrà automàticament; cal una revisió tècnica abans de continuar.</p>}
  {status?.state==='completed'&&<p className="text-sm">S’han comprovat les pàgines i els registres recuperats; la disponibilitat de la font pública pot ser incompleta.</p>}
  {status?.state==='not_started'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)} disabled={!status.can_start||busy}/><span>Entenc el límit de cobertura i vull iniciar aquesta cerca una vegada.</span></label>}
  <Button type="button" disabled={!status?.can_start||!accepted||busy} onClick={()=>void begin()}>{busy?'Iniciant…':'Recuperar concerts de 2020 a 2023'}</Button>
  {message&&<p role="status" className="text-sm">{message}</p>}
 </section>;
}

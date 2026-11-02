import {HISTORICAL_CONCERT_TERMS} from './historical-discovery';
import type {HistoricalSource} from './historical-executor';

const MAX_RESPONSE_BYTES=2_000_000;
type FetchAdapter=(url:URL,init:RequestInit)=>Promise<Response>;

/** Explicitly injected fetch only; constructing this source makes no request.
 * Production must provide a fetch implementation that honors AbortSignal. */
export function createHistoricalEtaulerSource(fetcher:FetchAdapter):HistoricalSource {
 return {async readPage(term,page,signal){
  if(!HISTORICAL_CONCERT_TERMS.includes(term)||!Number.isSafeInteger(page)||page<0||page>=5000||signal.aborted)throw new Error('INVALID_SOURCE_REQUEST');
  const url=new URL('https://tauler.seu-e.cat/api/edictes');
  url.searchParams.set('page',String(page));url.searchParams.set('size','25');url.searchParams.set('sort','dataPublicacioEfectiva,desc');
  url.searchParams.set('ens','1');url.searchParams.set('locale','ca');
  const response=await fetcher(url,{method:'POST',redirect:'error',cache:'no-store',signal,
   headers:{'Content-Type':'application/json','User-Agent':'mapeig-cartera-serveis-poc/0.1'},
   body:JSON.stringify({conceptes:[],cerca:term,destacat:null,state:'0'})});
  if(signal.aborted){if(response.body)void response.body.cancel().catch(()=>{});throw new Error('SOURCE_ABORTED');}
  if(!response.ok||!response.body){if(response.body)void response.body.cancel().catch(()=>{});throw new Error('SOURCE_UNAVAILABLE');}
  const length=response.headers.get('content-length');
  if(length!==null&&/^\d+$/.test(length)&&Number(length)>MAX_RESPONSE_BYTES){void response.body.cancel().catch(()=>{});throw new Error('SOURCE_RESPONSE_TOO_LARGE');}
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0,complete=false;
  let onAbort:()=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>{void reader.cancel().catch(()=>{});reject(new Error('SOURCE_ABORTED'));};signal.addEventListener('abort',onAbort,{once:true});});
  try {
   while(true){
    if(signal.aborted)throw new Error('SOURCE_ABORTED');
    const next=await Promise.race([reader.read(),aborted]);
    if(signal.aborted)throw new Error('SOURCE_ABORTED');
    if(next.done){complete=true;break;}
    bytes+=next.value.byteLength;
    if(bytes>MAX_RESPONSE_BYTES){void reader.cancel().catch(()=>{});throw new Error('SOURCE_RESPONSE_TOO_LARGE');}
    chunks.push(next.value);
   }
  } finally {signal.removeEventListener('abort',onAbort);if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as unknown;
 }};
}

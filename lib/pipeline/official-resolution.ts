import {fetchWithLimits} from './document-input';
export const OFFICIAL_DOCUMENT_HOSTS=['contractaciopublica.cat','tauler.seu-e.cat','desal-pro-download-bucket.s3.eu-west-1.amazonaws.com'];
type Json=Record<string,unknown>;
type ReadJson=(url:string)=>Promise<Json>;
export type Resolution={original_url:string;resolved_url:string;publication_id:string;case_id:string;document_type:string;method:string;resolved_at:string;result:'resolved'|'unresolved';diagnostic?:string;relation_path?:string};
export async function officialJson(url:string){const r=await fetchWithLimits(url,{allowedHosts:OFFICIAL_DOCUMENT_HOSTS});if(!r.mimeType.includes('json'))throw Error('Official metadata is not JSON');return JSON.parse(r.bytes.toString('utf8')) as Json;}
export async function resolveOfficialDocuments(original:string,read:ReadJson=officialJson):Promise<Resolution[]>{
 const url=new URL(original);const now=new Date().toISOString();
 const base={original_url:original,resolved_url:original,publication_id:'',case_id:'',document_type:'publication',method:'official-metadata-v1',resolved_at:now};
 try{
  if(url.hostname==='contractaciopublica.cat'){
   const match=url.pathname.match(/^\/(?:ca|es|en|oc)\/detall-publicacio\/([a-f0-9-]{36})\/(\d+)$/i);if(!match)return [];
   const [,expedient,publication]=match;
   // Endpoint and document contract verified in PSCP's public Angular client.
   const endpoint=(id:string)=>`https://contractaciopublica.cat/portal-api/detall-publicacio-expedient/${expedient}/${id}`;
   const first=await read(endpoint(publication));
   if(first.expedientId!==expedient||String(first.publicacioId)!==publication)throw Error('Publication/case mismatch');
   const phases=Array.isArray(first.navegacioFases)?first.navegacioFases as Json[]:[];
   const ids=[publication,...phases.filter(p=>p.fase===1000040).map(p=>String(p.publicacioId))].filter((v,i,a)=>a.indexOf(v)===i).slice(0,3);
   const found:Resolution[]=[];
   for(const id of ids){
    const data=id===publication?first:await read(endpoint(id));
    if(data.expedientId!==expedient||String(data.publicacioId)!==id||data.codiExpedient!==first.codiExpedient)throw Error('Related publication belongs to another case');
    const walk=(value:unknown,path:string)=>{if(!value||typeof value!=='object')return;const object=value as Json;
     if(typeof object.id==='number'&&typeof object.hash==='string'&&/^[a-f0-9]{32}$/i.test(object.hash)&&typeof object.titol==='string'){
      const type=/plecsDePrescripcionsTecniques/.test(path)?'technical_specifications':/plecsDeClausulesAdministratives/.test(path)?'regulatory_basis':/annex/i.test(object.titol)?'annex':'publication';
      found.push({...base,publication_id:id,case_id:expedient,document_type:type,resolved_url:`https://contractaciopublica.cat/portal-api/descarrega-document/${object.id}/${object.hash}`,result:'resolved',relation_path:`${endpoint(id)}#${path}`});
     }
     for(const [key,item]of Object.entries(object))walk(item,`${path}.${key}`);
    };walk(data.dades,'dades');
   }
   return found.length?found.sort((a,b)=>Number(b.document_type==='technical_specifications')-Number(a.document_type==='technical_specifications')).slice(0,15):[{...base,case_id:expedient,publication_id:publication,result:'unresolved',diagnostic:'No official linked documents'}];
  }
  if(url.hostname==='tauler.seu-e.cat'&&url.pathname==='/detall'){
   const id=url.searchParams.get('idEdicte');const ens=url.searchParams.get('idEns');if(!id||!ens||!/^\d+$/.test(id)||!/^\d+$/.test(ens))return [];
   const endpoint=`https://tauler.seu-e.cat/api/edictes/${id}?ens=${ens}&locale=ca`;const data=await read(endpoint);
   if(String(data.id_edicte)!==id)throw Error('Edict identity mismatch');
   const found:Resolution[]=[];
   for(const doc of (Array.isArray(data.documents)?data.documents:[]) as Json[]){if(typeof doc.uuidEdicte==='string'&&/^[a-f0-9-]{36}$/i.test(doc.uuidEdicte))found.push({...base,publication_id:id,case_id:ens,resolved_url:`https://tauler.seu-e.cat/api/documents/${doc.uuidEdicte}/info?ens=${ens}`,result:'resolved',relation_path:`${endpoint}#documents`});}
   for(const doc of (Array.isArray(data.adjunts)?data.adjunts:[]) as Json[]){
    if(typeof doc.uuid==='string'&&/^[a-f0-9-]{36}$/i.test(doc.uuid))found.push({...base,publication_id:id,case_id:ens,document_type:'annex',resolved_url:`https://tauler.seu-e.cat/api/documents/${doc.uuid}/info?ens=${ens}`,result:'resolved',relation_path:`${endpoint}#adjunts`});
    else if(typeof doc.url==='string'&&new URL(doc.url).protocol==='https:'&&OFFICIAL_DOCUMENT_HOSTS.includes(new URL(doc.url).hostname))found.push({...base,publication_id:id,case_id:ens,document_type:'annex',resolved_url:doc.url,result:'resolved',relation_path:`${endpoint}#adjunts`});
   }
   return found.length?found.slice(0,15):[{...base,publication_id:id,case_id:ens,result:'unresolved',diagnostic:'No official linked documents'}];
  }
  return [];
 }catch{return [{...base,result:'unresolved',diagnostic:'Official relationship could not be verified; retain insufficient evidence'}];}
}
export async function fetchOfficialDocument(url:string){
 const parsed=new URL(url);
 if(parsed.hostname==='tauler.seu-e.cat'&&/^\/api\/documents\/[a-f0-9-]+\/info$/.test(parsed.pathname)){
  const data=await officialJson(url);if(typeof data.url!=='string')throw Error('Missing official download URL');
  return fetchWithLimits(data.url,{allowedHosts:OFFICIAL_DOCUMENT_HOSTS});
 }
 return fetchWithLimits(url,OFFICIAL_DOCUMENT_HOSTS.includes(parsed.hostname)?{allowedHosts:OFFICIAL_DOCUMENT_HOSTS}:undefined);
}

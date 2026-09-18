'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
export function RetryJob({recordId,jobId,operation}:{recordId:string;jobId:string;operation:'prepare'|'enrich'|'match'}){
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function retry(){setBusy(true);try{const response=await fetch(`/api/records/${recordId}/operation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,expectedJobId:jobId})});const data=await response.json();if(!response.ok)throw Error(data.error);setMessage('Reintent iniciat. Es conserva la traçabilitat.');router.refresh();}catch(error){setMessage(error instanceof Error?error.message:'No s’ha pogut iniciar.');}finally{setBusy(false);}}
 return <div className="mt-2"><button className="rounded border px-3 py-2" disabled={busy} onClick={retry}>{busy?'Iniciant…':'Reintentar aquesta fase'}</button>{message&&<p role="status">{message}</p>}</div>;
}

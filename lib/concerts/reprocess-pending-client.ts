'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import {concertReprocessStorageKey,parseConcertReprocessPending,type ConcertReprocessPending} from './reprocess-recovery';

const eventName='concert-reprocess-pending-changed';
const unavailable='!storage-unavailable';
function subscribe(listener:()=>void){
  window.addEventListener('storage',listener);
  window.addEventListener(eventName,listener);
  return()=>{window.removeEventListener('storage',listener);window.removeEventListener(eventName,listener);};
}
const serverSnapshot=()=>undefined;

/** Session-scoped recovery survives refresh without exposing a server/client
 * hydration mismatch. A storage failure blocks a new request before sending. */
export function useConcertReprocessPending(recordId:string,enabled:boolean){
  const snapshot=useCallback(()=>{
    if(!enabled)return null;
    try{return window.sessionStorage.getItem(concertReprocessStorageKey(recordId));}
    catch{return unavailable;}
  },[enabled,recordId]);
  const raw=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  const state=useMemo(()=>{
    if(raw===undefined)return {pending:null,ready:false,error:''};
    try{return {pending:raw===null?null:parseConcertReprocessPending(raw,recordId),ready:true,error:''};}
    catch{return {pending:null,ready:false,error:'No s’ha pogut recuperar l’estat de les peticions d’aquest concert al navegador. No s’iniciarà cap petició nova fins que es pugui comprovar.'};}
  },[raw,recordId]);
  const save=useCallback((pending:ConcertReprocessPending|null)=>{
    const key=concertReprocessStorageKey(recordId);
    if(pending)window.sessionStorage.setItem(key,JSON.stringify(pending));
    else window.sessionStorage.removeItem(key);
    window.dispatchEvent(new Event(eventName));
  },[recordId]);
  return {...state,save};
}

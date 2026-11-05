import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {BULK_SCOPE_LIMIT,confirmScopeProposals,listPendingScopeProposals} from '@/lib/convenis/scope-confirmation';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';

async function guard(db:ReturnType<typeof createServerSupabase>){
 try{await requireConsistentConveniReads(db);return null;}
 catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
}
export async function GET(){
 const db=createServerSupabase();
 const blocked=await guard(db);if(blocked)return blocked;
 try{return Response.json({proposals:await listPendingScopeProposals(db),limit:BULK_SCOPE_LIMIT});}
 catch(error){return Response.json({error:error instanceof Error?error.message:'No s’han pogut carregar les propostes.'},{status:500});}
}
export async function POST(request:Request){
 const b=await request.json().catch(()=>null);
 const ids:unknown=b?.recordIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>BULK_SCOPE_LIMIT||!ids.every(isUuid)||new Set(ids).size!==ids.length||typeof b?.note!=='string'||b.note.trim().length<10)
  return Response.json({error:`Selecciona entre 1 i ${BULK_SCOPE_LIMIT} propostes i escriu una justificació de 10 caràcters com a mínim.`},{status:400});
 const db=createServerSupabase();
 const blocked=await guard(db);if(blocked)return blocked;
 if(independentConveniReadersEnabled())return Response.json({error:'Les decisions individuals de convenis estan temporalment desactivades mentre s’integra el circuit versionat.'},{status:503});
 try{return Response.json(await confirmScopeProposals(db,ids as string[],b.note.trim()));}
 catch(error){return Response.json({error:error instanceof Error?error.message:'No s’han pogut confirmar les propostes.'},{status:500});}
}

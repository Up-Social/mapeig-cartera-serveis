import type {SupabaseClient} from '@supabase/supabase-js';

/** A deployed ledger must never disappear from legacy readers after rollback. */
export class ConveniIndependentReadUnavailable extends Error {
 constructor(){super('Hi ha revisions individuals de convenis o no se’n pot comprovar l’estat. Cal restablir els lectors compatibles abans de consultar o exportar resultats.');}
}
export const independentConveniReadersEnabled=()=>process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED==='true'&&process.env.CONVENI_INDEPENDENT_READERS_READY==='true';
export async function requireConsistentConveniReads(db:SupabaseClient):Promise<void>{
 let result;
 try{result=await db.from('app_settings').select('enabled').eq('key','conveni_independent_ledger').maybeSingle();}
 catch{throw new ConveniIndependentReadUnavailable();}
 if(result.error)throw new ConveniIndependentReadUnavailable();
 const marker=result.data?.enabled;
 if(marker!==undefined&&typeof marker!=='boolean')throw new ConveniIndependentReadUnavailable();
 const requested=process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED==='true'||process.env.CONVENI_INDEPENDENT_READERS_READY==='true';
 if(requested&&process.env.LOCAL_REMOTE_LEGACY_SCHEMA==='true')throw new ConveniIndependentReadUnavailable();
 if((marker===true&&!independentConveniReadersEnabled())||(requested&&(!independentConveniReadersEnabled()||marker===undefined)))throw new ConveniIndependentReadUnavailable();
}

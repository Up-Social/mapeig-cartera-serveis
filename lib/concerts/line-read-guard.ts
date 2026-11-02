import type {SupabaseClient} from '@supabase/supabase-js';
export const lineReadersEnabled=()=>process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true';
export class LineReadUnavailable extends Error {
 constructor(){super('Hi ha revisions individuals de Concerts o no se’n pot comprovar l’estat. Cal restablir els lectors compatibles abans de consultar o exportar resultats.');}
}
/** Fail closed if legacy readers could hide an existing independent ledger. */
export async function requireConsistentLineReads(db:SupabaseClient):Promise<void>{
 if(lineReadersEnabled())return;
 const result=await db.rpc('concert_line_ledger_exists');
 if(result.error||result.data!==false)throw new LineReadUnavailable();
}

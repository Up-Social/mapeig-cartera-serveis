/** Local UI, existing remote Supabase. No Docker, migrations, fixtures or workers. */
import {loadEnvConfig} from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {runManagedProcess} from './managed-process';
const PROJECT='vvzxlevbfjvzygorbpxn';
async function main(){
 loadEnvConfig(process.cwd());
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||new URL(url).hostname!==`${PROJECT}.supabase.co`||!key)throw Error('Configura las credenciales existentes de Mapeig Cartera Serveis en el entorno. Este arranque solo admite su Supabase remoto.');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
 const records=await db.from('source_records').select('id',{count:'exact',head:true});
 if(records.error)throw Error(`No se ha podido verificar el acceso al proyecto remoto (${records.error.code}).`);
 const schema=await db.from('service_provisions').select('unit_id').limit(0);
 const legacy=!!schema.error;
 if(schema.error&&!['42703','PGRST204'].includes(schema.error.code))throw Error(`No se ha podido comprobar el esquema remoto (${schema.error.code}).`);
 const env:NodeJS.ProcessEnv={...process.env,WORKER_EXECUTION_MODE:'disabled',WATCHPACK_WATCHER_LIMIT:'20',LOCAL_REMOTE_PREVIEW:'true',LOCAL_REMOTE_LEGACY_SCHEMA:String(legacy)};
 delete env.WORKFLOW_TEST_PROJECT;delete env.WORKFLOW_TEST_E2E;delete env.WORKFLOW_BUILD_ISOLATED;
 console.log(`Supabase remoto: Mapeig Cartera Serveis (${PROJECT}); ${records.count} registros. Docker no se utiliza.`);
 console.log(legacy?'Esquema remoto anterior: lectura compatible; unidades y selector anual pendientes de migración.':'Esquema de unidades disponible.');
 console.log('Procesamiento automático desactivado en este arranque local. Sin migraciones ni reprocesamiento.');
 const port=process.env.PORT??'3108';
 const child=runManagedProcess(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','localhost','-p',port],{env,stdio:'inherit'});
 child.on('error',()=>{console.error('No se ha podido arrancar el servidor local');process.exitCode=1;});
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Error de configuración remota');process.exitCode=1;});

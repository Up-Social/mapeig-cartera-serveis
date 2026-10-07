/** Prepare one transactional psql bundle with exact Supabase migration history. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const names=[
 '20261007100000_case_storage_provenance',
 '20261007101000_import_row_archives',
 '20261007102000_case_storage_deletion_compatibility',
 '20261007103000_skip_snapshot_on_storage_metadata',
 '20261007104000_master_source_archives',
];
const root=resolve(import.meta.dirname,'..');
if(readFileSync(join(root,'supabase/.temp/project-ref'),'utf8').trim()!=='vvzxlevbfjvzygorbpxn')
 throw Error('El projecte Supabase enllaçat no és el de producció esperat');
const directory=mkdtempSync(join(tmpdir(),'mapeig-release-migrations-'));
const csv=join(directory,'migration-history.csv');
const sql=join(directory,'release.sql');
const migrations=names.map(name=>{
 const version=name.slice(0,14),title=name.slice(15);
 const path=join(root,'supabase/migrations',`${name}.sql`);
 const statement=readFileSync(path,'utf8');
 return {version,title,path,statement};
});
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
writeFileSync(csv,migrations.map(({version,title,statement})=>[version,title,statement].map(quote).join(',')).join('\n')+'\n',{mode:0o600});
const escapePsql=(value:string)=>value.replaceAll("'","''");
writeFileSync(sql,[
 '\\set ON_ERROR_STOP on',
 'CREATE TEMP TABLE release_migration_input(version text PRIMARY KEY,name text,statement text);',
 `\\copy release_migration_input FROM '${escapePsql(csv)}' WITH (FORMAT csv)`,
 'DO $$ BEGIN',
 ' IF (SELECT count(*) FROM release_migration_input) <> 5 THEN RAISE EXCEPTION \'Inventario de migraciones incompleto\'; END IF;',
 ' IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s JOIN release_migration_input r USING(version)) THEN RAISE EXCEPTION \'Migracion ya aplicada: detener y reconciliar\'; END IF;',
 'END $$;',
 ...migrations.map(({path})=>`\\ir ${path}`),
 'INSERT INTO supabase_migrations.schema_migrations(version,statements,name)',
 ' SELECT version,ARRAY[statement],name FROM release_migration_input ORDER BY version;',
 'SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN (SELECT version FROM release_migration_input) ORDER BY version;',
].join('\n')+'\n',{mode:0o600});
console.log(`Paquete local preparado: ${sql}`);
console.log('Aplica las cinco migraciones y su historial en una transacción con psql -X -1 -v ON_ERROR_STOP=1 -W -f RUTA.');

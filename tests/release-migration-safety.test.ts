import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('the obsolete release generator refuses to produce executable migration files',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mapeig-release-safety-'));
 try {
  const result=spawnSync(process.execPath,['--import','tsx','scripts/prepare-release-migrations.ts'],{
   cwd:process.cwd(),encoding:'utf8',env:{PATH:process.env.PATH,TMPDIR:directory,NODE_ENV:'test'},
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/paquet històric de migracions està desactivat/i);
  assert.deepEqual(readdirSync(directory).filter(name=>name.startsWith('mapeig-release-migrations-')),[]);
 } finally {rmSync(directory,{recursive:true,force:true});}
});

import {createHash} from 'node:crypto';
import {createProvisionExcel, type ProvisionExcelRow} from '../../../lib/provision-excel';

export type FrozenLine = {decision_id:string; snapshot:ProvisionExcelRow};
// PRIVATE PROTOTYPE. Do not return the bytes unless the receipt succeeds.
export async function exportFrozenLines(lines: FrozenLine[], commit: (hash:string, expected:FrozenLine[])=>Promise<void>) {
  const ordered=[...lines].sort((a,b)=>a.decision_id.localeCompare(b.decision_id));
  const rows=ordered.map(({snapshot})=>({...snapshot,service_name:snapshot.service_code,source_records:{financing_type:'concert'}}));
  const bytes=await createProvisionExcel(rows);
  const hash=createHash('sha256').update(bytes).digest('hex');
  await commit(hash,ordered);
  return {bytes,hash};
}

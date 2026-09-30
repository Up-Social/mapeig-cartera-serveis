/** Only the local remote-data launcher enables compatibility before deployment. */
import type { ProvisionExcelRow } from './provision-excel';

/** Database projection; unit columns are optional on the pre-migration schema. */
export type ExportProvision = Omit<ProvisionExcelRow, 'service_name'> & {
 id: string;
 master_services?: unknown;
 official_services?: unknown;
 source_records?: unknown;
};

export function hasUnitSchema(){return process.env.LOCAL_REMOTE_LEGACY_SCHEMA!=='true';}
export function schemaSelect(columns:string){
 return hasUnitSchema()?columns:columns.replaceAll(',unit_id,centre,period,act_type,annex_reference','').replaceAll(',superseded_at','');
}

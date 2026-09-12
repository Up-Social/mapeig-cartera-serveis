import type { SupabaseClient } from '@supabase/supabase-js';

export type OfficialService = {
  version_id: string; service_code: string; service_name: string; parent_code: string | null;
  benefit_type: 'service' | 'economic' | 'technological'; description: string;
  target_population: string; conditions: string; legal_reference: string;
  normative_fields: Record<string, string>;
};
export function eligibleServices<T extends Pick<OfficialService, 'service_code' | 'benefit_type'>>(all: T[]): T[] {
  return all.filter(item => item.benefit_type === 'service' && !all.some(child => child.service_code.startsWith(`${item.service_code}.`)));
}
export function assertEligible(code: string, all: OfficialService[]) {
  const service = eligibleServices(all).find(item => item.service_code === code);
  if (!service) throw new Error(`Codi no elegible: ${code}. Cal una prestació de servei sense fills.`);
  return service;
}
export function validateCatalog(all: OfficialService[]) {
  const codes = new Set(all.map(s => s.service_code));
  if (codes.size !== all.length || !all.length) throw new Error('Catàleg buit o amb codis duplicats');
  for (const s of all) {
    if (!/^[123](?:\.\d+)*$/.test(s.service_code) || !s.service_name.trim() || !s.legal_reference) throw new Error(`Fitxa incompleta: ${s.service_code}`);
    const parent = s.service_code.includes('.') ? s.service_code.slice(0, s.service_code.lastIndexOf('.')) : null;
    if (parent !== s.parent_code || (parent && !codes.has(parent))) throw new Error(`Jerarquia incompleta: ${s.service_code}`);
    if (s.benefit_type !== ({'1':'service','2':'economic','3':'technological'} as const)[s.service_code[0] as '1'|'2'|'3']) throw new Error(`Tipus inconsistent: ${s.service_code}`);
  }
  for (const s of eligibleServices(all)) if (!s.description || !s.target_population || !s.conditions) throw new Error(`Falten dades normatives: ${s.service_code}`);
}
export async function loadOfficialCatalog(db: SupabaseClient) {
  const {data: version, error} = await db.from('catalog_versions').select('*').eq('active', true).eq('validated', true).single();
  if (error || !version) throw new Error('Catàleg oficial complet i validat no disponible');
  const result = await db.from('official_services').select('*').eq('version_id', version.id).order('service_code').limit(1000);
  if (result.error) throw result.error;
  const all = (result.data ?? []) as OfficialService[];
  validateCatalog(all);
  if (all.length !== version.entry_count) throw new Error('Càrrega incompleta del catàleg');
  return {version, all, eligible: eligibleServices(all)};
}
export function normativeContext(service: OfficialService, all: OfficialService[]) {
  return all.filter(s => service.service_code === s.service_code || service.service_code.startsWith(`${s.service_code}.`)).map(s => ({code:s.service_code,name:s.service_name,fields:s.normative_fields,reference:s.legal_reference}));
}

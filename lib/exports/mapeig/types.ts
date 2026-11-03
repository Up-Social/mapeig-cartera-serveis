import type {SupabaseClient} from '@supabase/supabase-js';
import type {FinancingType} from '@/lib/financing-types';

/** Values of the client's v2 template lists (Detall_Registres columns D, I, J). */
export type MapeigMechanism='Concert'|'Subvenció'|'Conveni'|'Contractació';
export type MapeigSource='RAISC'|'PSCP'|'Registre de Convenis'|'e-Tauler';
export type MapeigProvince='Barcelona'|'Tarragona'|'Girona'|'Lleida';
export const MAPEIG_PROVINCES:readonly MapeigProvince[]=['Barcelona','Tarragona','Girona','Lleida'];
export const MAPEIG_MECHANISMS:readonly MapeigMechanism[]=['Concert','Subvenció','Conveni','Contractació'];
export const MECHANISM_BY_TYPE:Record<FinancingType,MapeigMechanism>={concert:'Concert',subvencio:'Subvenció',conveni:'Conveni',contractacio:'Contractació'};
export const SOURCE_BY_TYPE:Record<FinancingType,MapeigSource>={concert:'e-Tauler',subvencio:'RAISC',conveni:'Registre de Convenis',contractacio:'PSCP'};
export const MAPEIG_TYPE_LABELS:Record<FinancingType,string>={concert:'Concerts',subvencio:'Subvencions',conveni:'Convenis',contractacio:'Contractacions'};
/** Typologies the export can produce today. The others stay visible but disabled. */
export const MAPEIG_AVAILABLE_TYPES:readonly FinancingType[]=['concert'];
export const MAPEIG_EXPORT_MAX_ROWS=20000;

/** One Detall_Registres row: the 11 template columns (A–K) plus extra columns
 * from L onwards that the summary formulas never read. */
export type DetallRegistresRow={
 sourceUrl:string|null;sourceId:string;            // A
 providerName:string|null;providerNif:string|null; // B, C
 mechanism:MapeigMechanism;                         // D
 awardDate:string|null;                             // E (ISO yyyy-mm-dd)
 amount:number|null;                                // F euros, signed; null = blank
 contractingBody:string|null;                       // G
 targetPopulation:string|null;                      // H
 province:MapeigProvince|null;                      // I
 source:MapeigSource;                               // J
 carteraCode:string|null;                           // K
 extras:Record<string,string|number|null>;          // L→ keyed by ExtraColumn.key
 observations:string[];                             // joined into the «Observacions» extra
};
export type ExtraColumn={key:string;header:string;width?:number};

export type MapeigFilters={
 financingTypes:FinancingType[];
 provinces:MapeigProvince[]|null; // null = all
 awardDateFrom:string|null;       // ISO, inclusive
 awardDateTo:string|null;         // ISO, inclusive
};

export type ProviderContext={origin:string;catalogCodes:Map<string,string>};
export type ProviderResult={rows:DetallRegistresRow[];notes:string[]};
export interface ExportRowProvider{
 readonly financingType:FinancingType;
 readonly extraColumns:readonly ExtraColumn[];
 load(db:SupabaseClient,context:ProviderContext):Promise<ProviderResult>;
}

export class MapeigFilterError extends Error{constructor(message:string){super(message);this.name='MapeigFilterError';}}
export class MapeigTemplateError extends Error{constructor(message:string){super(message);this.name='MapeigTemplateError';}}
export class MapeigUnavailableTypeError extends Error{constructor(message:string){super(message);this.name='MapeigUnavailableTypeError';}}

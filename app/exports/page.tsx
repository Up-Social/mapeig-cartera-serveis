import {headers} from 'next/headers';
import {createServerSupabase} from '@/lib/records-page';
import {LineReadUnavailable} from '@/lib/concerts/line-read-guard';
import {previewMapeigExport,type MapeigPreview} from '@/lib/exports/mapeig';
import {parseMapeigFilters} from '@/lib/exports/mapeig/filters';
import {listMapeigExports} from '@/lib/exports/mapeig/history';
import {MAPEIG_MIN_YEAR,MapeigFilterError,MapeigUnavailableTypeError,type MapeigExportRecord,type MapeigFilters} from '@/lib/exports/mapeig/types';
import {ExportForm} from './export-form';

export const dynamic='force-dynamic';
const DEFAULT_FILTERS:MapeigFilters={financingTypes:['concert'],provinces:null,yearFrom:null,yearTo:null};

/** The preview is computed server-side from the same parser as the download
 * route, so what the page shows is what the file will contain. */
export default async function ExportsPage({searchParams}:PageProps<'/exports'>){
 const params=await searchParams;
 const applied=params.applied==='1';
 const db=createServerSupabase();
 let filters=DEFAULT_FILTERS,filterError:string|null=null,preview:MapeigPreview|null=null,previewError:string|null=null;
 if(applied){
  try{filters=parseMapeigFilters(params);}
  catch(error){if(error instanceof MapeigFilterError)filterError=error.message;else throw error;}
  if(!filterError){
   const headerList=await headers();
   const origin=`${headerList.get('x-forwarded-proto')??'https'}://${headerList.get('x-forwarded-host')??headerList.get('host')??''}`;
   try{preview=await previewMapeigExport(db,filters,origin);}
   catch(error){
    if(error instanceof LineReadUnavailable||error instanceof MapeigUnavailableTypeError)previewError=error.message;
    else{console.error('mapeig preview failed',error);previewError='No s’ha pogut calcular el resum de l’exportació. Torna-ho a provar; si el problema persisteix, revisa la disponibilitat del servei.';}
   }
  }
 }
 let history:MapeigExportRecord[]=[],historyError:string|null=null;
 try{history=await listMapeigExports(db);}
 catch(error){console.error('mapeig history failed',error);historyError='No s’ha pogut carregar l’històric d’exportacions.';}
 const currentYear=new Date().getFullYear();
 const years=Array.from({length:currentYear-MAPEIG_MIN_YEAR+1},(_,i)=>currentYear-i);
 return <main className="page-shell"><section className="page-container space-y-5">
  <div><p className="page-eyebrow">Resultats · lliurament</p><h1 className="page-title">Exportacions</h1><p className="page-description">Genera el llibre Excel «Mapeig de la Cartera» amb les línies que compleixin els filtres. Primer aplica els filtres per veure el resum; després descarrega el fitxer. Cada fitxer generat queda a l’històric amb la seva data.</p></div>
  <ExportForm filters={filters} years={years} applied={applied} filterError={filterError} preview={preview} previewError={previewError} history={history} historyError={historyError}/>
 </section></main>;
}

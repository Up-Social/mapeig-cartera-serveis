import {headers} from 'next/headers';
import {createServerSupabase} from '@/lib/records-page';
import {LineReadUnavailable} from '@/lib/concerts/line-read-guard';
import {previewMapeigExport,type MapeigPreview} from '@/lib/exports/mapeig';
import {parseMapeigFilters} from '@/lib/exports/mapeig/filters';
import {MapeigFilterError,MapeigUnavailableTypeError,type MapeigFilters} from '@/lib/exports/mapeig/types';
import {ExportForm} from './export-form';

export const dynamic='force-dynamic';
const DEFAULT_FILTERS:MapeigFilters={financingTypes:['concert'],provinces:null,awardDateFrom:null,awardDateTo:null};

/** The preview is computed server-side from the same parser as the download
 * route, so what the page shows is what the file will contain. */
export default async function ExportsPage({searchParams}:PageProps<'/exports'>){
 const params=await searchParams;
 const applied=params.applied==='1';
 let filters=DEFAULT_FILTERS,filterError:string|null=null,preview:MapeigPreview|null=null,previewError:string|null=null;
 if(applied){
  try{filters=parseMapeigFilters(params);}
  catch(error){if(error instanceof MapeigFilterError)filterError=error.message;else throw error;}
  if(!filterError){
   const headerList=await headers();
   const origin=`${headerList.get('x-forwarded-proto')??'https'}://${headerList.get('x-forwarded-host')??headerList.get('host')??''}`;
   try{preview=await previewMapeigExport(createServerSupabase(),filters,origin);}
   catch(error){
    if(error instanceof LineReadUnavailable||error instanceof MapeigUnavailableTypeError)previewError=error.message;
    else{console.error('mapeig preview failed',error);previewError='No s’ha pogut calcular el resum de l’exportació. Torna-ho a provar; si el problema persisteix, revisa la disponibilitat del servei.';}
   }
  }
 }
 return <main className="page-shell"><section className="page-container space-y-5">
  <div><p className="page-eyebrow">Resultats · lliurament</p><h1 className="page-title">Exportacions</h1><p className="page-description">Genera el llibre Excel «Mapeig de la Cartera» amb les línies que compleixin els filtres. Primer aplica els filtres per veure el resum; després descarrega el fitxer.</p></div>
  <ExportForm filters={filters} applied={applied} filterError={filterError} preview={preview} previewError={previewError}/>
 </section></main>;
}

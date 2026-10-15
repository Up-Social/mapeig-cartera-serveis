import ExcelJS from 'exceljs';
import {createServerSupabase} from '@/lib/records-page';
import {readPages} from '@/lib/read-pages';
export const dynamic='force-dynamic';
export async function GET(){
 const db=createServerSupabase();
 const records=await readPages((from,to)=>db.from('current_record_results').select('id,title,financing_type,job_id').eq('destination','reserved').order('id').range(from,to));
 const reservations=await readPages((from,to)=>db.from('current_record_reservations').select('*').eq('action','accept').order('source_record_id').range(from,to));
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Acceptats amb reserves');
 sheet.addRow(['Registre','Títol','Tipologia','Estat','Motiu','Mancances','Persona revisora (nom declarat)','Data','Execució']);
 for(const r of records){const h=reservations.find(h=>h.source_record_id===r.id&&h.pipeline_job_id===r.job_id);if(h)sheet.addRow([r.id,r.title,r.financing_type,'Provisional · exclòs de totals definitius',h.reason,h.missing_items,h.reviewer,h.created_at,r.job_id]);}
 sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=30;});
 return new Response(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="acceptats-amb-reserves.xlsx"','Cache-Control':'no-store'}});
}

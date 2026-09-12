import ExcelJS from 'exceljs';
import {classificationReport} from '@/lib/classification-report';
export const dynamic='force-dynamic';
export async function GET(){
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Fora de cartera');
 sheet.addRow(['Identificador','Servei descrit','Destinataris','Import','Font','Documents','Justificació automàtica','Revisió humana','Versió normativa','Evidència']);
 let page=1,total=0;
 do {const report=await classificationReport('out_of_portfolio',page,500);total=report.total;for(const r of report.rows){const source=r.source_records;sheet.addRow([source?.source_record_id,r.service_description,r.target_population,(Array.isArray(source?.record_enrichments)?source.record_enrichments[0]:source?.record_enrichments)?.amount??source?.amount,source?.source_dataset,(source?.source_documents??[]).map((d:{url:string})=>d.url).join('\n'),r.explanation,r.review_notes,r.catalog_version_id,JSON.stringify(r.evidence)]);}page++;}while((page-1)*500<total);
 sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=28;});
 const bytes=await workbook.xlsx.writeBuffer();return new Response(new Uint8Array(bytes as unknown as ArrayBuffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Fora-de-cartera.xlsx"','Cache-Control':'no-store'}});
}

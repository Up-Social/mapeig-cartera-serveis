import {createOutsideExportWorkbook} from '@/lib/outside-export-workbook';
import {classificationReport} from '@/lib/classification-report';
import {conveniOutsideAmountPending,outsideExportAmount,outsideExportExplanation,OUTSIDE_AMOUNT_NOTE} from '@/lib/outside-export-amount';
export const dynamic='force-dynamic';
export async function GET(){
 const {workbook,sheet}=createOutsideExportWorkbook();
 let page=1,total=0;
 do {const report=await classificationReport('out_of_portfolio',page,500);total=report.total;for(const r of report.rows){const source=r.source_records;const amount=outsideExportAmount(source);const row=sheet.addRow([source?.source_record_id,r.service_description,r.target_population,amount,source?.source_dataset,(source?.source_documents??[]).map((d:{url:string})=>d.url).join('\n'),outsideExportExplanation(source,r.explanation),r.review_notes,r.catalog_version_id,JSON.stringify(r.evidence)]);if(conveniOutsideAmountPending(source))row.getCell(4).note=OUTSIDE_AMOUNT_NOTE;}page++;}while((page-1)*500<total);
 sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=28;});
 const bytes=await workbook.xlsx.writeBuffer();return new Response(new Uint8Array(bytes as unknown as ArrayBuffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Fora-de-cartera.xlsx"','Cache-Control':'no-store'}});
}

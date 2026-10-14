import ExcelJS from 'exceljs';
import {createServerSupabase} from '@/lib/records-page';
import {loadConcertEvolution} from '@/lib/concerts/evolution-store';
import {concertEvolution} from '@/lib/concerts/evolution';
import {isUuid} from '@/lib/uuid';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),id=url.searchParams.get('record')??undefined;
 if(id&&!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const cutoff=url.searchParams.get('cutoff')??new Date().toISOString().slice(0,10);
 try{
  const data=await loadConcertEvolution(createServerSupabase(),id),result=concertEvolution(data,cutoff);
  const book=new ExcelJS.Workbook();
  const note=book.addWorksheet('Criteris');
  note.addRows([['Horitzó',2024],['Data de tall',cutoff],['Regles',result.version],['Ús','La foto és un saldo; els moviments són el seu historial. No s’han de sumar les dues pestanyes.'],['Pendents',result.pending],['Exclosos',result.excluded],['Import','Euros del període acreditat; màxims identificats. No és despesa real executada.'],['Entitat','La foto conserva l’entitat original; les cessions consten als moviments, sense reatribuir despesa històrica.']]);
  const balances=book.addWorksheet('Foto consolidada');
  balances.addRow(['Concert original','Entitat original','Servei','Territori','Període','Finançador','Import EUR','Màxim','Estat / impediments']);
  result.balances.forEach(b=>balances.addRow([b.rootId,b.provider,b.service,b.territory,b.period,b.funder,b.amountCents===null?null:b.amountCents/100,b.maximum?'Sí':'No',b.issues.join(' · ')||'Revisat']));
  const movements=book.addWorksheet('Moviments i pendents');
  movements.addRow(['Línia','Registre','Original','Entitat de l’acte','Operació','Període','Data efectes','Import documental EUR','Estat','Impediments','Enllaç fitxa']);
  result.movements.forEach(m=>movements.addRow([m.unitId,m.recordId,m.rootId,m.provider,m.operation,m.period,m.effectiveAt,m.amountCents===null?null:m.amountCents/100,m.status,m.issues.join(' · '),`${url.origin}/records/${m.recordId}#concert-economics`]));
  for(const sheet of book.worksheets){sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=26;});sheet.views=[{state:'frozen',ySplit:1}];}
  balances.getColumn(7).numFmt='#,##0.00';movements.getColumn(8).numFmt='#,##0.00';
  const buffer=await book.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="concerts-${cutoff}.xlsx"`,'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'No s’ha pogut generar la foto dels concerts. Comprova la data de tall.'},{status:400});}
}

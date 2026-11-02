import ExcelJS from 'exceljs';
import {ECONOMIC_AMOUNT_LABELS,type concertEvolution} from './evolution';

/** Export the same reviewed projection shown in the UI. Unknown balances remain
 * empty and movements are kept separate, so they cannot be mistaken for totals. */
export async function createConcertEvolutionExcel(result:ReturnType<typeof concertEvolution>,cutoff:string,origin:string){
 const book=new ExcelJS.Workbook();
 const note=book.addWorksheet('Criteris');
 note.addRows([['Horitzó',2024],['Data de tall',cutoff],['Regles',result.version],['Ús','La foto és un saldo; els moviments són el seu historial. No s’han de sumar les dues pestanyes.'],['Pendents',result.pending],['Exclosos',result.excluded],['Import','Euros del període acreditat; màxims identificats. No és despesa real executada.'],['Entitat','La foto mostra el titular vigent; l’historial conserva les entitats anteriors. La cessió no suma nou finançament.'],['Territori','La ubicació complementària només s’aplica amb revisió humana vigent, sense conflictes; cada moviment conserva proposta, decisió i hash de la font. No acredita finançador ni imports.']]);
 const balances=book.addWorksheet('Foto consolidada');
 balances.addRow(['Concerts originals','Entitat vigent','Servei','Territori','Període','Finançador','Import EUR','Màxim','Estat / impediments']);
 result.balances.forEach(b=>balances.addRow([b.rootIds.join(' · '),b.provider,b.service,b.territory,b.period,b.funder,b.amountCents===null?null:b.amountCents/100,b.maximum?'Sí':'No',b.issues.join(' · ')||'Revisat']));
 const movements=book.addWorksheet('Moviments i pendents');
 movements.addRow(['Línia','Registre','Original','Entitat de l’acte','Operació','Període','Data efectes','Import documental EUR','Estat','Impediments','Enllaç fitxa','Tipus d’import','Territori aplicat','Proposta geogràfica','Decisió geogràfica','Estat geogràfic','Font geogràfica','SHA-256 font geogràfica','Revisor geogràfic']);
 result.movements.forEach(m=>movements.addRow([m.unitId,m.recordId,m.rootId,m.provider,m.operation,m.period,m.effectiveAt,m.amountCents===null?null:m.amountCents/100,m.status,m.issues.join(' · '),`${origin}/records/${m.recordId}#concert-economics`,m.operation==='nonfinancial'?'Sense nou import':ECONOMIC_AMOUNT_LABELS[m.amountKind],m.territory??null,m.supplementalGeography?.id??null,m.supplementalGeography?.review_id??null,m.supplementalGeography?.conflict?'Conflicte':m.supplementalGeography?.decision??'Sense decisió complementària',m.supplementalGeography?.source_url??null,m.supplementalGeography?.source_sha256??null,m.supplementalGeography?.reviewer??null]));
 for(const sheet of book.worksheets){sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=26;});sheet.views=[{state:'frozen',ySplit:1}];}
 balances.getColumn(7).numFmt='#,##0.00';movements.getColumn(8).numFmt='#,##0.00';
 return new Uint8Array(await book.xlsx.writeBuffer());
}

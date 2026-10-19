import ExcelJS from 'exceljs';
import {createProvisionExcel,type ProvisionExcelRow} from '../provision-excel';
import {SOURCE_NAME,type ConveniUnit} from './contract';
export type ConveniExportRow=ProvisionExcelRow&{data:ConveniUnit;instrument_grant:boolean;related:string[];annexes:string[]};
export async function createConveniExcel(rows:ConveniExportRow[],warnings:string[],legacy=false) {
 if(legacy)return createProvisionExcel(rows,{reviewWarnings:[...warnings,'Imports públics previstos revisats; no són pagaments. Consulta Detall_Registres per a l’estat de cada anualitat.']});
 const workbook=new ExcelJS.Workbook();workbook.creator='Mapeig cartera de serveis';
 const sheet=workbook.addWorksheet('Detall_Registres',{views:[{state:'frozen',ySplit:1}]});
 const columns=[['ID d’origen','source_id',22],['Convocatòria (enllaç)','call_url',42],['Bases reguladores (enllaç)','regulatory_basis_url',25],['Nom entitat beneficiària','provider_name',38],['NIF entitat','provider_nif',18],['Mecanisme','mechanism',18],['Data concessió / signatura','award_date',24],['Import públic previst (€)','amount',24],['Òrgan contractant / finançadors','contracting_body',38],['Població objectiu / beneficiaris','target_population',38],['Territori del servei','territory',30],['Font','source_reference',42],['Codi Cartera (servei)','service_code',22],['Nom servei','service_name',42],['ID unitat','unit_id',38],['Període','period',28],['Anualitat','year',16],['Estat de l’import','amount_state',28],['Instrumenta subvenció','instrument_grant',24],['Convenis relacionats','related',38],['Annexos','annexes',48]] as const;
 sheet.columns=columns.map(([header,key,width])=>({header,key,width}));
 sheet.getRow(1).font={name:'Arial',bold:true};sheet.getRow(1).alignment={wrapText:true};sheet.getRow(1).height=34;
 sheet.autoFilter={from:'A1',to:'U1'};
 for(const r of rows){const row=sheet.addRow({...r,source_reference:SOURCE_NAME,territory:r.data.territory,year:r.data.year,amount_state:({planned:'Previst',conditional:'Condicionat',confirmed:'Concessió confirmada'})[r.data.amount_state],instrument_grant:r.instrument_grant?'Sí':'No',related:r.related.join('; '),annexes:r.annexes.join('\n'),regulatory_basis_url:null,call_url:r.call_url?{text:r.call_url,hyperlink:r.call_url}:null,award_date:r.award_date?new Date(`${r.award_date}T00:00:00Z`):null});row.font={name:'Arial',size:10};row.alignment={vertical:'top',wrapText:true};row.getCell(7).numFmt='yyyy-mm-dd';row.getCell(8).numFmt='#,##0.00';}
 const notes=workbook.addWorksheet('Estat_Exportacio');notes.columns=[{header:'Abast i limitacions',key:'note',width:110}];notes.getRow(1).font={name:'Arial',bold:true};
 for(const note of ['Aportació pública prevista revisada. No equival a pagaments; les anualitats condicionades no són concessions fermes.','Només unitats aprovades amb evidència vigent. No se sumen totals pare i anualitats.','Les coincidències amb altres mecanismes no estan conciliades.',...warnings]){const row=notes.addRow({note});row.font={name:'Arial',size:10};row.alignment={wrapText:true};}
 return new Uint8Array(await workbook.xlsx.writeBuffer());
}

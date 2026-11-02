import ExcelJS from 'exceljs';
import {OUTSIDE_AMOUNT_NOTE} from './outside-export-amount';

export const OUTSIDE_POPULATION_NOTE='«Destinataris» reprodueix la descripció de l’anàlisi automàtica. La revisió de la classificació no acredita automàticament tots els atributs d’aquesta descripció; contrasteu-la amb l’evidència i les notes de revisió.';

/** Keep the legacy sheet and A:J contract; the note does not replace cell data. */
export function createOutsideExportWorkbook(){
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('Fora de cartera');
 sheet.addRow(['Identificador','Servei descrit','Destinataris','Import','Font','Documents','Justificació automàtica','Revisió humana','Versió normativa','Evidència']);
 sheet.getCell('C1').note=OUTSIDE_POPULATION_NOTE;
 sheet.getCell('D1').note=OUTSIDE_AMOUNT_NOTE;
 return {workbook,sheet};
}

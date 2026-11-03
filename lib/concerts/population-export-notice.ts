/** Only the canonical source type identifies a Concert. This export contains
 * no per-line population provenance; neither a value nor a blank proves one. */
export type PopulationExportInput={target_population?:string|null;source_records?:unknown};
function isConcert(row:PopulationExportInput):boolean {
 const source=Array.isArray(row.source_records)?row.source_records[0]:row.source_records;
 return !!source&&typeof source==='object'&&(source as {financing_type?:unknown}).financing_type==='concert';
}
function notInformed(row:PopulationExportInput):boolean {
 return row.target_population==null||typeof row.target_population==='string'&&!row.target_population.trim();
}
export function concertPopulationNotInformedCount(rows:readonly PopulationExportInput[]):number {
 return rows.filter(row=>isConcert(row)&&notInformed(row)).length;
}
export function concertPopulationNotice(rows:readonly PopulationExportInput[],language:'ca'|'es'):string|null {
 const concerts=rows.filter(isConcert),empty=concerts.filter(notInformed).length,informed=concerts.length-empty;
 if(!concerts.length)return null;
 const text:string[]=[];
 if(informed)text.push(language==='ca'
  ? `La població informada en ${informed} ${informed===1?'registre de concert':'registres de concerts'} pot correspondre al conjunt de l’expedient; aquesta exportació no acredita la seva atribució a cada línia.`
  : `La población informada en ${informed} ${informed===1?'registro de concierto':'registros de conciertos'} puede corresponder al conjunto del expediente; esta exportación no acredita su atribución a cada línea.`);
 if(empty)text.push(language==='ca'
  ? `Població no informada en ${empty} ${empty===1?'registre de concert':'registres de concerts'}. Un camp buit no identifica una decisió de revisió.`
  : `Población no informada en ${empty} ${empty===1?'registro de concierto':'registros de conciertos'}. Un campo vacío no identifica una decisión de revisión.`);
 return text.join(' ');
}

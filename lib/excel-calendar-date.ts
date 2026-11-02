/** A date column represents a calendar date, not an instant in local time.
 * Excel's 1900 system contains a fictitious leap day, so earlier dates fail
 * closed instead of silently shifting. */
export class ExcelCalendarDateError extends Error {
 constructor(sourceId?:string){
  const label=sourceId?.replace(/[\r\n\t]+/g,' ').slice(0,100);
  super(`Data de concessió no vàlida${label?` del registre ${label}`:''}. Cal una data real entre 1900-03-01 i 9999-12-31.`);
  this.name='ExcelCalendarDateError';
 }
}
export function excelCalendarDate(value:string|null,sourceId?:string):Date|null {
 if (value===null) return null;
 if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-03-01') throw new ExcelCalendarDateError(sourceId);
 const date = new Date(`${value}T00:00:00.000Z`);
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new ExcelCalendarDateError(sourceId);
 return date;
}

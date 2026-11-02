import type {SourceRecord} from '@/lib/workbench-types';
import {sourceComparison} from '@/lib/source-comparison';
import {WorkTable} from '@/components/work-list';
export function SourceComparison({record}:{record:SourceRecord}){
 if((record.financingType==='concert'&&record.sourceDataset!=='contractacions')||!record.sourceFile)return null;
 return <section className="mt-5"><h3 className="font-semibold">Contrast amb l’Excel d’origen</h3><p className="mt-1 text-sm">{record.sourceDataset==='contractacions'||record.financingType==='contractacio'?'En contractació es conserva l’import d’adjudicació informat i verificable. Un pressupost, un valor estimat o un import documental sense naturalesa acreditada queden pendents; la resta de camps buits es poden completar amb el document. Les diferències requereixen revisió.':'Es conserva el valor de l’Excel quan hi consta. El document completa els camps buits. Les diferències requereixen revisió; la prioritat de l’Excel no confirma la correspondència amb la Cartera.'}</p><div className="mt-3"><WorkTable profile="sourceComparison">{sourceComparison(record).map(row=><tr key={row.label}>{[row.label,row.original??'—',row.document??'—',row.status,`${row.effective??'—'} (${row.origin})`].map((value,index)=><td key={index}>{value}</td>)}</tr>)}</WorkTable></div></section>;
}

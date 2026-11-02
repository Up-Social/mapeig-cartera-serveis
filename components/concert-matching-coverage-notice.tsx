import {generalConcertMatchingCoverage,type MatchingCoverageUnit} from '@/lib/concerts/matching-coverage';
import type {SourceRecord} from '@/lib/workbench-types';

export function ConcertMatchingCoverageNotice({record,units}:{record:Pick<SourceRecord,'financingType'|'analysis'>;units:ReadonlyArray<MatchingCoverageUnit>}){
 const count=generalConcertMatchingCoverage(record,units);
 if(count===null)return null;
 return <aside role="status" data-testid="concert-matching-coverage-notice" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
  <p className="font-semibold">Cobertura de la proposta general pendent de contrast</p>
  <p className="mt-1">Les línies d’adjudicació no rebutjades mostren {count} codis diferents. La proposta general pot mostrar fins a tres alternatives i no acredita per si sola la correspondència de cada línia.</p>
  <p className="mt-1">Contrasta cada codi amb el document i la fitxa del servei. Aquest recompte no confirma els serveis ni els imports i no modifica les decisions de revisió.</p>
 </aside>;
}

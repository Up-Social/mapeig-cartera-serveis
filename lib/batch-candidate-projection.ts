import {projectLatestCandidates} from './candidate-projection';
import type {StoredAnalysis} from './analysis-contract';

/** A batch contains one specific job, including verification jobs. Keep its
 * stored candidates separate from observations and preserve existing status. */
export function projectBatchCandidates(item:unknown,analysis:StoredAnalysis|null) {
 const {candidates,observations,invalidScoreReason}=projectLatestCandidates([item]);
 const unreliable=analysis?.reliability_status==='invalidated'||!!invalidScoreReason;
 const visibleAnalysis=analysis&&invalidScoreReason?{...analysis,reliability_status:'invalidated' as const,
  reliability_reasons:[...new Set([...(analysis.reliability_reasons??[]),invalidScoreReason])]}:analysis;
 return {analysis:visibleAnalysis,matchingCandidates:unreliable?[]:candidates,
  unverifiedCandidateObservations:unreliable?[]:observations};
}

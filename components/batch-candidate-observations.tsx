import type {BatchJob} from '@/lib/batch-types';
import {UnverifiedCandidateObservations} from './unverified-candidate-observations';

/** Defensive presentation guard: invalidated results are not review evidence. */
export function BatchCandidateObservations({job}:{job:BatchJob}) {
 if(job.analysis?.reliability_status==='invalidated')return null;
 return <UnverifiedCandidateObservations observations={job.unverifiedCandidateObservations}/>;
}

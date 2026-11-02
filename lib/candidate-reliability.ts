/** Use the same ordered job for both score checks and candidate display. */
export function latestCandidateJob(value:unknown):Record<string,unknown>|null {
 if(!Array.isArray(value))return null;
 const jobs=value.filter((job):job is Record<string,unknown>=>!!job&&typeof job==='object'&&!Array.isArray(job));
 return jobs.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0]??null;
}

/** Assess all candidates of the latest job before any catalog visibility filter.
 * The query can contain PostgreSQL numeric values as strings. */
export function latestJobInvalidCandidateReason(value:unknown):'non_positive_confidence'|'invalid_candidate_confidence'|null {
 const latest=latestCandidateJob(value);
 if(!latest||!Array.isArray(latest.matching_candidates))return null;
 let invalid=false;
 for(const candidate of latest.matching_candidates){
  if(!candidate||typeof candidate!=='object'){invalid=true;continue;}
  const score=(candidate as Record<string,unknown>).score;
  if((typeof score!=='number'&&typeof score!=='string')||(typeof score==='string'&&!score.trim())){invalid=true;continue;}
  const numeric=Number(score);
  if(Number.isFinite(numeric)&&numeric<=0)return 'non_positive_confidence';
  if(!Number.isFinite(numeric)||numeric>1)invalid=true;
 }
 return invalid?'invalid_candidate_confidence':null;
}

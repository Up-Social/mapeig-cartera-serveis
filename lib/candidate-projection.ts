import officialSnapshot from '../data/legal/cartera.json';
import {eligibleServices,type OfficialService} from './official-catalog';
import type {SourceRecord,UnverifiedCandidateObservation} from './workbench-types';
import {latestCandidateJob,latestJobInvalidCandidateReason} from './candidate-reliability';
const officialByCode=new Map(eligibleServices(officialSnapshot.services as OfficialService[]).map(s=>[s.service_code,s]));

function mapLatestCandidates(value: unknown): SourceRecord["matchingCandidates"] {
  const latest = latestCandidateJob(value);
  if (!latest || !Array.isArray(latest.matching_candidates)) return [];
  return latest.matching_candidates.filter(candidate => officialByCode.has(String((candidate as Record<string,unknown>).target_code))).map((candidate) => {
    const item = candidate as Record<string, unknown>;
    const links = Array.isArray(item.matching_candidate_evidence) ? item.matching_candidate_evidence : [];
    return {
      id: String(item.id), pipelineJobId: String(item.pipeline_job_id), rank: Number(item.rank), targetCode: String(item.target_code), targetName: String(item.target_name),
      score: Number(item.score), rationale: String(item.rationale), model: String(item.engine_version),
      serviceDetail: {sectorScope:officialByCode.get(String(item.target_code))?.target_population??null,portfolioStatus:"Dentro"},
      catalogVersionId: String(item.catalog_version_id ?? ""),
      // A reference from the bundled snapshot is only attributable to the
      // candidate when both version identifiers agree.
      legalReference:String(item.catalog_version_id??'')===officialSnapshot.version.id?officialByCode.get(String(item.target_code))?.legal_reference:undefined,
      evidence: links.flatMap((link) => {
        const relation = link as Record<string, unknown>;
        const chunk = relation.evidence_chunks;
        if (!chunk || typeof chunk !== "object") return [];
        const evidence = chunk as Record<string, unknown>;
        return [{ ordinal: Number(evidence.ordinal), content: String(evidence.content), explanation: relation.explanation == null ? null : String(relation.explanation) }];
      }).sort((a, b) => a.ordinal - b.ordinal),
    };
  }).sort((a, b) => a.rank - b.rank);
}

/** Preserve the stored text of filtered candidates as observations only.
 * This does not certify historical catalog membership or a Concert exception. */
function mapUnverifiedObservations(value:unknown):UnverifiedCandidateObservation[] {
 const latest=latestCandidateJob(value);
 if(!latest||!Array.isArray(latest.matching_candidates))return [];
 const text=(v:unknown)=>typeof v==='string'&&v.trim()?v:null;
 return latest.matching_candidates
  .filter(candidate=>candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&!officialByCode.has(String((candidate as Record<string,unknown>).target_code)))
  .map(candidate=>{
   const item=candidate as Record<string,unknown>;
   const links=Array.isArray(item.matching_candidate_evidence)?item.matching_candidate_evidence:[];
   const evidence=links.flatMap(link=>{
    if(!link||typeof link!=='object'||Array.isArray(link))return [];
    const relation=link as Record<string,unknown>;
    const chunks=Array.isArray(relation.evidence_chunks)?relation.evidence_chunks:[relation.evidence_chunks];
    return chunks.flatMap(chunk=>{
     if(!chunk||typeof chunk!=='object'||Array.isArray(chunk))return [];
     const raw=chunk as Record<string,unknown>;
     const ordinal=typeof raw.ordinal==='number'&&Number.isInteger(raw.ordinal)?raw.ordinal:null;
     return [{ordinal,content:text(raw.content),explanation:text(relation.explanation)}];
    });
   });
   return {id:String(item.id),targetCode:text(item.target_code),targetName:text(item.target_name),catalogVersionId:text(item.catalog_version_id),rationale:text(item.rationale),evidence};
  });
}

/** Compute reliability before catalog filtering can hide a stored candidate. */
export function projectLatestCandidates(value:unknown) {
 const invalidScoreReason=latestJobInvalidCandidateReason(value);
 return {candidates:invalidScoreReason?[]:mapLatestCandidates(value),observations:invalidScoreReason?[]:mapUnverifiedObservations(value),invalidScoreReason};
}

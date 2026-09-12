import type {StoredAnalysis} from './analysis-contract';
export function latestAnalysis(jobs:unknown):StoredAnalysis|null {
 if(!Array.isArray(jobs))return null;
 const job=[...jobs].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
 const value=job?.analysis_results;
 return (Array.isArray(value)?value[0]:value)??null;
}

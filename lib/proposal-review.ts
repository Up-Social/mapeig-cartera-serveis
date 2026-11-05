/** Shared marker for automatic results that are only proposals: the analysis
 * (a scope rule or a model) suggested an outcome that a person must confirm.
 * Stored in analysis_results.rule_audit.proposal; current_record_results
 * routes these results to review while no human decision exists. */
export type ProposalMarker={kind:'discard'|'units';reason?:string;rule?:string;source?:'excel'|'model';requires_review:true};
export const isPendingProposal=(audit:Record<string,unknown>|null|undefined)=>{
 const proposal=audit?.proposal;
 return !!proposal&&typeof proposal==='object'&&(proposal as {requires_review?:unknown}).requires_review===true;
};

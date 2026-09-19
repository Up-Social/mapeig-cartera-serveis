type Json=Record<string,unknown>;
function object(value:unknown):Json{return value&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};}
function array(value:unknown):Json[]{return Array.isArray(value)?value.map(object):[];}
export function summarizeSnapshot(payload:unknown){
 const p=object(payload),a=object(p.analysis),job=object(p.job),review={...object(p.review)};
 review.notes=review.reason??review.notes;
 const start=Date.parse(String(job.claimed_at??job.created_at??'')),end=Date.parse(String(job.completed_at??''));
 const elapsed=Number.isFinite(start)&&Number.isFinite(end)?(end-start)/1000:null;
 return {classification:a.classification??null,reasons:a.reasons??[],explanation:a.explanation??null,humanClassification:review.classification??a.reviewed_classification??null,humanNotes:review.notes??a.review_notes??null,codes:array(p.candidates).map(c=>({code:c.target_code,score:c.score})),evidence:a.evidence??[],documents:array(p.documents).map(v=>{const d=object(v.document);return {url:d.url??null,hash:d.content_hash??null,resolution:d.resolution??null};}),phases:p.phases??null,durationSeconds:elapsed!==null&&elapsed>0?elapsed:null,usage:array(p.provider_calls).map(c=>object(c.response).usage).filter(Boolean),cost:null,provenance:p.provenance??null};
}
export function compareSnapshots(before:unknown,after:unknown){const origin=summarizeSnapshot(before),current=summarizeSnapshot(after);return {origin,current,classificationChanged:origin.classification!==current.classification,codesChanged:JSON.stringify(origin.codes)!==JSON.stringify(current.codes),humanReviewPending:!current.humanClassification};}

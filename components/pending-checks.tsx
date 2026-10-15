/** Keep every pending condition readable, using the width of its actual card. */
export function PendingChecks({issues}:{issues:readonly string[]}){
 if(!issues.length)return null;
 return <ul aria-label="Comprovacions pendents" className="card-facts my-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-amber-900">{issues.map((issue,index)=><li key={`${issue}:${index}`} className="flex items-start gap-2"><span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-current"/><span className="min-w-0">{issue}</span></li>)}</ul>;
}

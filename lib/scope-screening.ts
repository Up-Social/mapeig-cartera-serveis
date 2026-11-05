/** Deterministic scope screening shared by every financing mechanism.
 * A rule reads only the source row (title and payload) and runs before any
 * document fetch, OCR or model call. `auto` rules may close a record when no
 * human decision exists; `proposal` rules only suggest a discard that a person
 * confirms. Each mechanism registers its own ordered rule list. */
export type ScopeMode='auto'|'proposal';
export type ScopeInput={title:string;payload:Record<string,unknown>};
export type ScopeFinding={reason:string;label:string;explanation:string};
export type ScopeProposal=ScopeFinding&{rule:string;version:string;mode:ScopeMode};
export type ScopeRule={id:string;mode:ScopeMode;evaluate:(input:ScopeInput)=>ScopeFinding|null};

export function screenRecord(rules:readonly ScopeRule[],version:string,input:ScopeInput):ScopeProposal|null{
 for(const rule of rules){
  const finding=rule.evaluate(input);
  if(finding)return {...finding,rule:rule.id,version,mode:rule.mode};
 }
 return null;
}

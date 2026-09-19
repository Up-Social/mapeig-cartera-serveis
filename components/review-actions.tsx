"use client";
import {useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {DISCARD_REASON_LABELS,REVIEW_LABELS,reviewValidation,type ReviewOutcome} from '@/lib/review-contract';

export function ReviewActions({notes,onNotesChange,reasons,onReasonsChange,pending,canSelect,canOutside,rectification,onSubmit}:{notes:string;onNotesChange:(s:string)=>void;reasons:string[];onReasonsChange:(s:string[])=>void;pending:boolean;canSelect:boolean;canOutside:boolean;rectification:boolean;onSubmit:(outcome:ReviewOutcome)=>void}) {
 const [decision,setDecision]=useState<ReviewOutcome|null>(null);
 const [error,setError]=useState('');
 const textarea=useRef<HTMLTextAreaElement>(null);
 const id=useId();
 function submit(outcome:ReviewOutcome){const message=reviewValidation(outcome,notes,reasons,rectification);if(message){setError(message);textarea.current?.focus();return;}setError('');onSubmit(outcome);}
 return <div className="mt-3 space-y-3">
  <label htmlFor={id} className="block text-sm font-medium">{decision==='reject'?'Explicació del descart':decision==='outside'?'Justificació del servei social fora de la cartera':decision==='insufficient'?'Evidència que falta':rectification?'Justificació de la rectificació':'Observacions de la selecció'}{decision||rectification?' (obligatori)':' (opcional)'}</label>
  <Textarea ref={textarea} id={id} value={notes} onChange={e=>onNotesChange(e.target.value)} maxLength={1000} rows={3} aria-required={!!decision||rectification} aria-invalid={!!error} aria-describedby={error?`${id}-error`:undefined}/>
  {decision==='reject'&&<fieldset className="space-y-2"><legend className="text-sm font-medium">Motius del descart (obligatori)</legend>{Object.entries(DISCARD_REASON_LABELS).map(([value,label])=><label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reasons.includes(value)} onChange={e=>onReasonsChange(e.target.checked?[...reasons,value]:reasons.filter(r=>r!==value))}/>{label}</label>)}</fieldset>}
  <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(REVIEW_LABELS) as ReviewOutcome[]).map(outcome=><Button key={outcome} type="button" variant={outcome==='select'?'default':'outline'} disabled={pending||(outcome==='select'&&!canSelect)||(outcome==='outside'&&!canOutside)} onClick={()=>{if(outcome==='select'){setDecision(null);submit(outcome);}else{setDecision(outcome);setError('');textarea.current?.focus();}}}>{REVIEW_LABELS[outcome]}</Button>)}</div>
  {decision&&<Button type="button" variant="outline" disabled={pending} onClick={()=>submit(decision)}>Confirmar: {REVIEW_LABELS[decision]}</Button>}
  {error&&<p id={`${id}-error`} role="alert" className="text-sm">{error}</p>}
 </div>;
}

import type {AnalysisOutput} from '../analysis-contract';
// A negative catalog conclusion requires affirmative evidence of scope. When the
// model itself declares missing facts, expose that uncertainty for human review.
// Never repair prohibited candidates or infer a replacement service.
export function normalizeMissingScope(value:AnalysisOutput):AnalysisOutput {
 if(value.classification==='out_of_portfolio' && Array.isArray(value.candidates) && value.candidates.length===0 && Array.isArray(value.reasons) && value.reasons.length===0 && (value.population_verified===false || value.social_service_verified===false)){
  return {...value,classification:'insufficient_evidence',explanation:'No es pot concloure que el servei sigui fora de cartera: manca acreditar el servei social o els destinataris. Cal revisar les fonts del registre.'};
 }
 return value;
}

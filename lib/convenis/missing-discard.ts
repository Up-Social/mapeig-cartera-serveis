/** Structured absence codes are not evidence of an exclusion. Do not infer
 * missing facts from free text or from null fields accompanying an independent
 * reason: the latter still needs documentary review on its own merits. */
export function missingDiscardDiagnostic(reason:unknown):{code:string;message:string}|null {
 if(typeof reason!=='string')return null;
 const value=reason.trim().toLowerCase();
 const specific:Record<string,{code:string;message:string}>={
  missing_nif:{code:'CONVENI_DISCARD_MISSING_NIF',message:'La proposta indica que no s’ha identificat el NIF del receptor. No és motiu de descart; queda pendent de contrast.'},
  invalid_nif:{code:'CONVENI_DISCARD_MISSING_NIF',message:'La proposta indica que el NIF del receptor no està acreditat. No és motiu de descart; queda pendent de contrast.'},
  unverified_identity:{code:'CONVENI_DISCARD_MISSING_IDENTITY',message:'La proposta indica que la identitat del receptor no està acreditada. No és motiu de descart; queda pendent de contrast.'},
  missing_recipient:{code:'CONVENI_DISCARD_MISSING_RECIPIENT',message:'La proposta indica que no s’ha identificat el receptor. No és motiu de descart; queda pendent de contrast.'},
  unknown_recipient:{code:'CONVENI_DISCARD_MISSING_IDENTITY',message:'La proposta indica que la naturalesa del receptor no està acreditada. No és motiu de descart; queda pendent de contrast.'},
  missing_amount:{code:'CONVENI_DISCARD_MISSING_AMOUNT',message:'La proposta indica que no s’ha identificat l’import. No és motiu de descart; queda pendent de contrast.'},
  missing_period:{code:'CONVENI_DISCARD_MISSING_PERIOD',message:'La proposta indica que no s’ha identificat el període. No és motiu de descart; queda pendent de contrast.'},
  missing_population:{code:'CONVENI_DISCARD_MISSING_POPULATION',message:'La proposta indica que no s’ha identificat la població destinatària. No és motiu de descart; queda pendent de contrast.'},
  missing_service:{code:'CONVENI_DISCARD_MISSING_SERVICE',message:'La proposta indica que no s’ha identificat el servei. No és motiu de descart; queda pendent de contrast.'},
  unknown_service:{code:'CONVENI_DISCARD_MISSING_SERVICE',message:'La proposta indica que el servei no està acreditat. No és motiu de descart; queda pendent de contrast.'},
  incomplete:{code:'CONVENI_DISCARD_MISSING_FIELD',message:'La proposta indica informació incompleta. No és motiu de descart; queda pendent de contrast.'},
 };
 if(Object.hasOwn(specific,value))return specific[value];
 return /^missing_[a-z0-9_]+$/.test(value)?{code:'CONVENI_DISCARD_MISSING_FIELD',message:'La proposta indica que falta un camp. No és motiu de descart; queda pendent de contrast.'}:null;
}

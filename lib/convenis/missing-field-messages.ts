/** Fixed messages refer to the proposal, not to the entire source document. */
export const conveniMissingFieldMessages:Record<string,string>={
 CONVENI_RECIPIENT_MISSING:'No s’ha identificat el receptor a la proposta del conveni. Queda pendent de contrast documental.',
 CONVENI_PERIOD_MISSING:'No s’ha identificat el període a la proposta del conveni. Queda pendent de contrast documental.',
 CONVENI_POPULATION_MISSING:'No s’ha identificat la població destinatària a la proposta del conveni. Queda pendent de contrast documental.',
 CONVENI_DESCRIPTION_MISSING:'No s’ha identificat la descripció del servei a la proposta del conveni. Queda pendent de contrast documental.',
 CONVENI_PROPOSAL_NIF_UNIDENTIFIED:'No s’ha identificat el NIF del receptor a la proposta. Cal contrastar el document.',
 CONVENI_DISCARD_MISSING_NIF:'La proposta indica que el NIF del receptor no està acreditat. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_IDENTITY:'La proposta indica que la identitat o naturalesa del receptor no està acreditada. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_RECIPIENT:'La proposta indica que no s’ha identificat el receptor. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_AMOUNT:'La proposta indica que no s’ha identificat l’import. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_PERIOD:'La proposta indica que no s’ha identificat el període. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_POPULATION:'La proposta indica que no s’ha identificat la població destinatària. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_SERVICE:'La proposta indica que el servei no està acreditat. No és motiu de descart; queda pendent de contrast.',
 CONVENI_DISCARD_MISSING_FIELD:'La proposta indica que falta un camp. No és motiu de descart; queda pendent de contrast.',
};

/** Only messages assembled from our fixed strings can be promoted in the UI. */
export function isConveniMissingFieldMessage(message:string):boolean {
 const parts=message.split('\n');
 const known=new Set(Object.values(conveniMissingFieldMessages));
 return parts.length>0&&parts.length<=known.size+1&&parts.some(part=>known.has(part))&&
  parts.every((part,index)=>known.has(part)||(index===0&&['Resposta no vàlida.','La proposta de descart està pendent de contrast documental. No s’ha descartat ni aprovat automàticament.'].includes(part)));
}

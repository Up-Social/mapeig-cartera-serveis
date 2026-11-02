/** A narrow, title-backed decision. Mixed and generic titles continue to PDF analysis. */
export function hasDefinitiveConcertAward(documentText:string):boolean{
 const text=documentText.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const marker=text.match(/\bresolc\b\s*:?\s*/);
 if(!marker)return false;
 const operative=text.slice(marker.index!+marker[0].length).split(/\n\s*(?:#{1,6}\s*)?annex\b/)[0].replace(/\s+/g,' ');
 // Look at operative clauses, including mixed award/denial decisions. A proposal
 // or a negated verb does not match the start of an affirmative clause.
 return /(?:^|\b\d+\s*[.)]\s*)(?:assignar|adjudicar|atorgar|aprovar la provisio)\b/.test(operative);
}

/** The current act may still be a correction/renewal even if it quotes an award. */
export function hasCurrentConcertAward(title:string,documentText?:string|null):boolean{
 const value=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return !!documentText&&!/\b(proposta|esmena|rectificaci|cessi[o]|cessament|convalidaci|recurs|prorrog|modificaci|ampliaci)/.test(value)
  &&hasDefinitiveConcertAward(documentText);
}

export function referencesConcertCallInTitle(title:string):boolean{
 const value=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 return /^resolucio de la convocatoria\b.*\bprovisio de (?:serveis|places)\b/.test(value);
}

export function concertNoAwardTitle(title:string,documentText?:string|null):{kind:'denial'|'proposal'|'call'|'vacant'|'spending';explanation:string}|null{
 const value=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 if(documentText&&!/\bproposta\b/.test(value)&&hasDefinitiveConcertAward(documentText))return null;
 // This form can name the call used by a later award, not the act being published.
 if(referencesConcertCallInTitle(title))return null;
 // A proposal can describe a future award; the word adjudicació there does
 // not turn the current proposal into a definitive award.
 if(/^(?:acord\s+proposta\b|proposta\s+de\s+resolucio\b|resolucio\s+(?:de\s+|d['’])proposta\b)/.test(value))
  return {kind:'proposal',explanation:'Aquest acte és una proposta prèvia: la provisió requereix una resolució definitiva.'};
 if(/\b(adjudic|provisi[oó] directa|assignaci[oó] de places|prorrog)/.test(value))return null;
 if(/^(?:resolucio|acord)\b.{0,120}\bdenegaci[oó]n?\b/.test(value)||/\bplaces denegades\b/.test(value))
  return {kind:'denial',explanation:'La resolució denega la sol·licitud o les places indicades i no adjudica cap concert nou.'};
 if(/^(?:acord|resolucio)\b.{0,100}\bproposta\b|^proposta\s+de\s+resolucio\b/.test(value))
  return {kind:'proposal',explanation:'Aquest acte és una proposta prèvia: la provisió requereix una resolució definitiva.'};
 if(/\bconvocatoria\b/.test(value))
  return {kind:'call',explanation:'La convocatòria obre el procediment però no adjudica cap servei a una entitat.'};
 if(/\bplaces desertes\b/.test(value))
  return {kind:'vacant',explanation:'Les places declarades desertes no s’han adjudicat en aquest acte.'};
 if(/\bautoritzacio (?:de |de la )?despesa\b/.test(value))
  return {kind:'spending',explanation:'L’autorització comptable no acredita per si sola una provisió nova.'};
 return null;
}

/** A possible award anywhere in the document prevents a title-only discard.
 * This intentionally includes negated, proposed and historical references.
 * Lexical detection cannot prove absence of an award (including OCR errors). */
function mayMentionConcertAward(text:string):boolean{
 const value=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return /\b(?:assign\w*|adjudic\w*|atorg\w*|conced\w*|concess\w*|concesi\w*|aprovar\s+la\s+provisio)\b/.test(value);
}

/** A title-based no-award rule is safe only when the evidence window has not
 * omitted any known chunk and every fetched document is represented. The
 * decision must also cite a fragment mentioning the operative subject. This
 * gate does not certify that discovery found every external document. */
export function concertNoAwardFromEvidence(
 title:string,
 documents:ReadonlyArray<{id:string}>,
 assessed:ReadonlyArray<{id:string;source_document_id:string;content:string;eligible:boolean}>,
 selected:ReadonlyArray<{id:string;source_document_id:string;content:string}>,
):{decision:NonNullable<ReturnType<typeof concertNoAwardTitle>>;evidenceOrdinal:number}|null{
 if(!documents.length||!assessed.length||assessed.some(chunk=>!chunk.eligible))return null;
 // A pinned window can contain an older version of a chunk with the same id.
 // A matching id alone does not prove that the cited evidence is the text
 // inspected for an award, nor that the document still belongs to this set.
 const selectedById=new Map(selected.map(chunk=>[chunk.id,chunk]));
 if(selectedById.size!==selected.length||selected.length!==assessed.length
  ||new Set(assessed.map(chunk=>chunk.id)).size!==assessed.length)return null;
 const documentIds=new Set(documents.map(document=>document.id));
 if(documentIds.size!==documents.length||assessed.some(chunk=>{
  const chosen=selectedById.get(chunk.id);
  return !documentIds.has(chunk.source_document_id)||!chosen
   ||chosen.source_document_id!==chunk.source_document_id||chosen.content!==chunk.content;
 }))return null;
 if(documents.some(document=>!assessed.some(chunk=>chunk.source_document_id===document.id)))return null;
 // Check each document independently: an annex boundary in one must not mask
 // a definitive award in another.
 if(documents.some(document=>{
  const text=assessed.filter(chunk=>chunk.source_document_id===document.id).map(chunk=>chunk.content).join('\n');
  return hasDefinitiveConcertAward(text)||mayMentionConcertAward(text);
 }))return null;
 const decision=concertNoAwardTitle(title,assessed.map(chunk=>chunk.content).join('\n'));
 if(!decision)return null;
 const subject=decision.kind==='denial'?/deneg|desestim/i:decision.kind==='proposal'?/proposta/i:decision.kind==='call'?/convocat/i:decision.kind==='vacant'?/desert/i:/despesa/i;
 const index=selected.findIndex(chunk=>subject.test(chunk.content));
 return index<0?null:{decision,evidenceOrdinal:index+1};
}

/** An award combined with another operative act needs line-level review before
 * a shared act type can be applied. Denials remain separately represented. */
export function hasMixedConcertFinancialActs(documentText:string):boolean{
 const text=documentText.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const marker=/\bresolc\s*:?\s*/.exec(text);
 if(!marker)return false;
 const operative=text.slice(marker.index+marker[0].length).split(/\n\s*(?:#{1,6}\s*)?annex\b/)[0].replace(/\s+/g,' ');
 const clause='(?:^|\\b\\d+\\s*[.)]\\s*)';
 const award=new RegExp(`${clause}(?:assignar|adjudicar|atorgar|aprovar la provisio)\\b`).test(operative);
 const change=new RegExp(`${clause}(?:modificar|ampliar|reduir|minorar|cessar|extingir|acceptar el cessament|esmenar|rectificar|corregir|cedir|traspassar|convalidar|(?:estimar|desestimar|resoldre)\\s+(?:parcialment\\s+)?(?:el|la|un)\\s+recurs)\\b`).test(operative);
 return award&&change;
}

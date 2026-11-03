const PROCEDURES:ReadonlyArray<[RegExp,string]>=[
 [/provisi[oó] no ordin[aà]ria/i,'provisió no ordinària'],
 [/provisi[oó] directa/i,'provisió directa'],
 [/modificaci[oó] de (?:places|pla[cç]a|serveis)|augment de places/i,'modificació'],
 [/convocat[oò]ria/i,'convocatòria'],
 [/autoritzaci[oó] de (?:la )?despesa/i,'autorització de despesa'],
 [/\besmen/i,'esmena'],
 [/(?<!\p{L})provisi[oó](?!\p{L})/iu,'provisió'],
];
/** The client asks for the mechanism alone ("Concert social" or "Concert social
 * / gestió delegada") and the procedure as a separate field. The extracted text
 * is free prose; only recognized terms are shown, the rest stays in the source. */
export function concertMechanismParts(value:string|null|undefined):{mechanism:string;procedure:string|null}|null{
 const text=value?.replace(/\s+/g,' ').trim();
 if(!text)return null;
 if(!/\bconcert\b/i.test(text))return {mechanism:text,procedure:null};
 const found=PROCEDURES.filter(([pattern])=>pattern.test(text)).map(([,label])=>label);
 const procedures=found.some(label=>label.startsWith('provisió '))?found.filter(label=>label!=='provisió'):found;
 return {mechanism:/gesti[oó] delegada/i.test(text)?'Concert social / gestió delegada':'Concert social',procedure:procedures.length?procedures.join(' · '):null};
}

/** A narrow reader for a single explicit award in the operative section.
 * Values stay documentary observations; it does not infer funding or a code. */
export type ResolcObservation={page:number;row:number;providerName:string;nif:string|null;serviceName:string;centre:string;territory:string|null;resesCode:string|null;quantity:number;quote:string};

export function extractResolcAward(text:string):ResolcObservation|null{
 const marker=/\bresolc\s*:/i.exec(text);
 if(!marker||marker.index===undefined)return null;
 const pageMatches=[...text.slice(0,marker.index).matchAll(/^## Pàgina (\d+)\s*$/gm)];
 const page=Number(pageMatches.at(-1)?.[1]??1);
 const normalized=text.slice(marker.index).replace(/\s+/g,' ').trim();
 const end=normalized.search(/\b\d+\.\s*Autoritzar\b/i);
 if(end<0)return null;
 const quote=normalized.slice(0,end).trim();
 if(quote.length>12000||quote.length<80)return null;
 const assignments=[...quote.matchAll(/\bassignar\s+a\s+l['’]entitat\b/gi)];
 if(assignments.length!==1||[...quote.matchAll(/\bNom\s+del\s+servei\s+social\s*:/gi)].length!==1)return null;
 const name=quote.match(/\bassignar\s+a\s+l['’]entitat\s+(.+?)(?=,\s*amb\s+NIF\b|,\s*\d+\s+places\b|\s+el\s+servei\b)/i)?.[1]?.trim();
 const service=quote.match(/(?:\b\d+\s+places\s+(?:de|del)\s+|\bel\s+servei\s+)(.+?)(?:,\s*)?\s+en\s+r[eè]gim\s+de\s+concert\s+social/i)?.[1]?.trim();
 const centre=quote.match(/\bNom\s+del\s+servei\s+social\s*:\s*(.+?)\s+N[uú]m\.\s*Expedient/i)?.[1]?.trim();
 const quantities=[...quote.matchAll(/\b(\d+)\s+places\b/gi)].map(match=>Number(match[1]));
 const nifs=[...new Set([...quote.matchAll(/\bNIF\s+([A-Z]\d{7}[0-9A-Z])\b/gi)].map(match=>match[1].toUpperCase()))];
 const codes=[...new Set([...quote.matchAll(/\bS\d{5}\b/g)].map(match=>match[0]))];
 const territory=quote.match(/\b(?:comarca|demarcaci[oó]\s+territorial)\s+(?:de\s+l['’]|de\s+la\s+|del\s+|de\s+|d['’])([^.;,]+)/i)?.[1]?.trim()??null;
 if(!name||!service||!centre||quantities.length!==1||!Number.isSafeInteger(quantities[0])||quantities[0]<1||nifs.length>1||codes.length>1)return null;
 return {page,row:1,providerName:name,nif:nifs[0]??null,serviceName:service,centre,territory,resesCode:codes[0]??null,quantity:quantities[0],quote};
}

/** Read multiple numbered awards only when every assignment has the same
 * explicit structure and a separate literal citation on a known page. This is
 * all-or-nothing: an ambiguous clause must not disappear from the result. */
export function extractResolcAwards(text:string):ResolcObservation[]{
 const marker=/\bresolc\s*:/i.exec(text);
 if(!marker||marker.index===undefined)return [];
 const start=marker.index+marker[0].length;
 const tail=text.slice(start);
 const stop=/\b\d+\.\s*Autoritzar\b/i.exec(tail);
 if(!stop||stop.index===undefined)return [];
 // No earlier award may be returned as complete if another assignment follows
 // the spending clause; the narrow reader cannot delimit that mixed act.
 if(/\bassignar\s+a\s+l['’]entitat\b/i.test(tail.slice(stop.index)))return [];
 const single=extractResolcAward(text);
 if(single)return /## Pàgina \d+/.test(single.quote)?[]:[single];
 const operative=tail.slice(0,stop.index);
 const assignments=[...operative.matchAll(/\bassignar\s+a\s+l['’]entitat\b/gi)];
 const numbered=[...operative.matchAll(/(?:^|\s)\d+[.)]\s*(assignar\s+a\s+l['’]entitat\b)/gi)];
 if(assignments.length<2||assignments.length!==numbered.length||assignments.length>1000)return [];
 const result:ResolcObservation[]=[];
 for(let index=0;index<numbered.length;index++){
  const match=numbered[index];
  const clauseStart=match.index!+match[0].toLowerCase().lastIndexOf('assignar');
  const clauseEnd=index+1<numbered.length?numbered[index+1].index!:operative.length;
  // A page marker between two complete clauses belongs to neither citation.
  const clause=operative.slice(clauseStart,clauseEnd).replace(/\n## Pàgina \d+[ \t]*\s*$/,'').trim();
  // A citation spanning page markers cannot have a single reliable page.
  if(/^## Pàgina \d+/m.test(clause))return [];
  const line=extractResolcAward(`RESOLC: ${clause} 999. Autoritzar`);
  if(!line)return [];
  const quote=line.quote.replace(/^RESOLC:\s*/i,'').trim();
  const preceding=text.slice(0,start+clauseStart);
  const page=Number([...preceding.matchAll(/^## Pàgina (\d+)\s*$/gm)].at(-1)?.[1]??1);
  result.push({...line,page,row:index+1,quote});
 }
 return result;
}

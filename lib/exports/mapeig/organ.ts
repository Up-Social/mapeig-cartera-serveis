/** Keyword classification of «Òrgan contractant», copied from the template's
 * Org_DSI / Org_AltresGeneralitat / Org_NoGeneralitat defined names. Excel's
 * SEARCH is case-insensitive and does not fold accents, so neither do we. */
export type OrganClass='dsi'|'altresGeneralitat'|'noGeneralitat';
export const ORGAN_CLASSES:readonly OrganClass[]=['dsi','altresGeneralitat','noGeneralitat'];
export const ORGAN_KEYWORDS:Record<OrganClass,readonly string[]>={
 dsi:['Drets Socials','ICASS'],
 altresGeneralitat:['Salut','Educaci','Departament','Generalitat'],
 noGeneralitat:['Ajuntament','Consell Comarcal','Diputaci','Mancomunitat','Municipal','Metropolitana','Ministeri','Estado','Gobierno'],
};
const contains=(text:string,keywords:readonly string[])=>keywords.some(keyword=>text.includes(keyword.toUpperCase()));
export function classifyOrgan(text:string|null|undefined):OrganClass|null{
 if(!text)return null;
 const upper=text.toUpperCase();
 if(contains(upper,ORGAN_KEYWORDS.dsi))return 'dsi';
 if(contains(upper,ORGAN_KEYWORDS.altresGeneralitat))return 'altresGeneralitat';
 if(contains(upper,ORGAN_KEYWORDS.noGeneralitat))return 'noGeneralitat';
 return null;
}

/** SUMIFS/COUNTIFS criteria are case-insensitive; `code&".*"` matches sublevels. */
export function codeMatches(rowCode:string|null|undefined,code:string):boolean{
 if(!rowCode)return false;
 const a=rowCode.toUpperCase(),b=code.toUpperCase();
 return a===b||a.startsWith(`${b}.`);
}
export const codeEquals=(rowCode:string|null|undefined,code:string)=>!!rowCode&&rowCode.toUpperCase()===code.toUpperCase();

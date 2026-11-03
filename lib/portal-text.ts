/** Only a known generic landing-page title, never substantive source text. */
export function isGenericPortalText(value:string){
 const normalized=value.replace(/\s+/g,' ').trim();
 return /^e[- ]?tauler\s*[-–—:]?\s*consorci administraci[oó] oberta de catalunya[.!]?$/i.test(normalized)||
  /^consorci administraci[oó] oberta de catalunya\s*[-–—:]?\s*e[- ]?tauler[.!]?$/i.test(normalized);
}
/** An auxiliary landing page (for example the e-TAULER notice page) whose
 * only text is the portal title. It is kept as provenance, not as evidence. */
export function isAuxiliaryPortalPage(doc:{documentType:string;qualityFlags:string[];extractedText?:string|null;textPreview?:string|null}){
 return doc.documentType==='other'&&!doc.qualityFlags.includes('corrupt_text')&&
  (doc.qualityFlags.includes('generic_portal')||isGenericPortalText(doc.extractedText??doc.textPreview??''));
}

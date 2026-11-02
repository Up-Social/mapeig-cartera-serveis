/** Only a known generic landing-page title, never substantive source text. */
export function isGenericPortalText(value:string){
 const normalized=value.replace(/\s+/g,' ').trim();
 return /^e[- ]?tauler\s*[-–—:]?\s*consorci administraci[oó] oberta de catalunya[.!]?$/i.test(normalized)||
  /^consorci administraci[oó] oberta de catalunya\s*[-–—:]?\s*e[- ]?tauler[.!]?$/i.test(normalized);
}

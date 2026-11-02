/** A document-backed candidate for human review, not an established link. */
export function provisionalResolutionPage(text:string,nif:string,reses:string[]):number|null{
 const markers=[...text.matchAll(/\bRESOLC\s*:\s*(?:1\s*[.)]\s*)?assignar\b/gi)];
 if(markers.length!==1||!text.includes(nif)||!reses.length||reses.some(code=>!text.includes(code)))return null;
 const pages=[...text.slice(0,markers[0].index).matchAll(/^##\s+Pàgina\s+(\d+)\s*$/gim)];
 return pages.length?Number(pages[pages.length-1][1]):null;
}

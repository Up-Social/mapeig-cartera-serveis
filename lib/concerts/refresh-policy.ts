type RefreshDocument = {
  document_type?: string | null;
  quality_flags?: readonly string[] | null;
  url?:string|null;
  source_fields?:readonly string[]|null;
};
import {fetchOfficialDocument} from '../pipeline/official-resolution';
import {htmlToText} from '../pipeline/document-input';
import {isGenericPortalText} from '../evidence-eligibility';

/** A previously identified navigation page is not documentary evidence.
 * Discovery may still visit it to locate the current official document. This
 * predicate only excludes it from the evidence refresh requirement; it does
 * not delete it, discard the case or treat its content as verified.
 * Never exclude a publication/annex, or an unknown/incomplete document, merely
 * because extraction failed or fields are absent. */
export function isConcertRefreshNavigationDocument(document: RefreshDocument): boolean {
  return document.document_type === 'other' &&
    Array.isArray(document.quality_flags) &&
    document.quality_flags.some(flag => flag === 'generic_portal' || flag === 'javascript_shell');
}

/** Legacy navigation entries can lack the generic flag. Skip only after a new
 * bounded read proves the exact e-Tauler record page is still just the known
 * generic shell. Unknown, failed or substantive pages remain blocking. */
export async function isConfirmedConcertNavigationShell(document:RefreshDocument,fetchDocument=fetchOfficialDocument):Promise<boolean>{
 if(document.document_type!=='other'||!document.source_fields?.includes('record_url')||!document.url)return false;
 try{
  const url=new URL(document.url);
  if(url.protocol!=='https:'||url.hostname!=='tauler.seu-e.cat'||url.pathname!=='/detall'||!/^\d+$/.test(url.searchParams.get('idEns')??'')||!/^\d+$/.test(url.searchParams.get('idEdicte')??''))return false;
  const result=await fetchDocument(document.url);
  if(!result.mimeType.includes('html'))return false;
  const html=result.bytes.toString('utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if(/<(?:iframe|object|embed)\b/i.test(html)||scripts.some(script=>!/\bsrc\s*=/i.test(script[1])||!!script[2].trim()))return false;
  return isGenericPortalText(htmlToText(html));
 }catch{return false;}
}

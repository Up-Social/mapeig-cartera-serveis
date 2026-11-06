import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
// A scanned official PDF can exceed 16 MiB (a 2025 conveni is 28 MB). Keep a
// bounded download; the archive bucket and archive verification use the same cap.
export const MAX_PDF_BYTES=40*1024*1024;
const MAX_BYTES=10*1024*1024,MAX_TEXT=200_000,TIMEOUT_MS=20_000;
import {HTML_COVERAGE_POLICY} from './document-coverage';
export {HTML_COVERAGE_POLICY,hasCurrentTextCoverage} from './document-coverage';
/** The response exceeds the download cap; distinct so callers can explain it. */
export class DocumentTooLargeError extends Error {constructor(public limitBytes:number){super('Document massa gran');}}
export async function fetchWithLimits(initialUrl: string,options?:{allowedHosts:string[]}) {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if(options&&!options.allowedHosts.includes(current.hostname))throw Error('Domini de redirecció no permès');
    const addresses=await assertPublicUrl(current);
    const response=await pinnedRequest(current,addresses[0]);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new Error(`Redirecció ${response.status} sense destinació`);
      current = new URL(location, current);
      continue;
    }
    if (response.status<200||response.status>=300) throw new Error(`HTTP ${response.status}`);
    const bytes=response.bytes;
    const headerType = response.headers['content-type']?.split(";")[0].trim().toLowerCase();
    const mimeType = headerType || inferMime(current.pathname, bytes);
    return { bytes, mimeType, finalUrl: current.toString(), status: response.status };
  }
  throw new Error("Massa redireccions");
}

function pinnedRequest(url:URL,address:{address:string;family:number}){
 return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;bytes:Buffer}>((resolve,reject)=>{
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{agent:false,family:address.family,lookup:(_host,_options,callback)=>callback(null,address.address,address.family),signal:AbortSignal.timeout(TIMEOUT_MS),headers:{'user-agent':'Mapeig-cartera-serveis-PoC/0.1','accept-encoding':'identity'}},async response=>{
   try{const status=response.statusCode??0;if(status>=300&&status<400){response.resume();resolve({status,headers:response.headers,bytes:Buffer.alloc(0)});return;}
    const maxBytes=response.headers['content-type']?.toLowerCase().startsWith('application/pdf')||url.pathname.toLowerCase().endsWith('.pdf')?MAX_PDF_BYTES:MAX_BYTES;
    if(Number(response.headers['content-length']??0)>maxBytes){response.destroy();throw new DocumentTooLargeError(maxBytes);}
    const chunks:Buffer[]=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>maxBytes){response.destroy();throw new DocumentTooLargeError(maxBytes);}chunks.push(Buffer.from(chunk));}resolve({status,headers:response.headers,bytes:Buffer.concat(chunks)});
   }catch(error){reject(error);}
  });request.on('error',reject);request.end();
 });
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Protocol no permès");
  if (url.username || url.password) throw new Error("Credencials a la URL no permeses");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Destinació de xarxa privada no permesa");
  return addresses;
}

export function isPrivateAddress(address: string) {
  if (!isIP(address)) return true;
  const normalized = address.toLowerCase();
  // Reject mapped/transition IPv6 altogether; never let hexadecimal IPv4 bypass the checks.
  if(isIP(address)===6&&!/^[23][0-9a-f]{3}:/.test(normalized))return true;
  if(normalized.startsWith('2002:')||normalized.startsWith('2001:0:'))return true;
  if (normalized === '::' || normalized === "::1" || /^fe[89ab]/.test(normalized) || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
    || (parts[0]===100&&parts[1]>=64&&parts[1]<=127)||parts[0]>=224||(parts[0]===198&&[18,19].includes(parts[1]));
}

export function htmlToText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
export function cleanTextWithCoverage(text: string) {
  const normalized=text.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  let end=Math.min(normalized.length,MAX_TEXT);
  if(end<normalized.length&&end>0&&normalized.charCodeAt(end-1)>=0xd800&&normalized.charCodeAt(end-1)<=0xdbff&&normalized.charCodeAt(end)>=0xdc00&&normalized.charCodeAt(end)<=0xdfff)end--;
  return {text:normalized.slice(0,end),partial:normalized.length>MAX_TEXT,
    coverage:{complete:normalized.length<=MAX_TEXT,characterLimit:MAX_TEXT,normalizedCharacters:normalized.length,policy:HTML_COVERAGE_POLICY}};
}
export function cleanText(text: string) { return cleanTextWithCoverage(text).text; }
function inferMime(pathname: string, bytes: Buffer) { return pathname.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF" ? "application/pdf" : "application/octet-stream"; }

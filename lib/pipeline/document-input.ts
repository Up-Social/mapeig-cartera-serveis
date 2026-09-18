import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
const MAX_BYTES=10*1024*1024,MAX_TEXT=200_000,TIMEOUT_MS=20_000;
export async function fetchWithLimits(initialUrl: string,options?:{allowedHosts:string[]}) {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if(options&&!options.allowedHosts.includes(current.hostname))throw Error('Domini de redirecció no permès');
    await assertPublicUrl(current);
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mapeig-cartera-serveis-PoC/0.1" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirecció ${response.status} sense destinació`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error(`Document massa gran: ${declared} bytes`);
    const bytes = await readLimitedBody(response);
    const headerType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const mimeType = headerType || inferMime(current.pathname, bytes);
    return { bytes, mimeType, finalUrl: current.toString(), status: response.status };
  }
  throw new Error("Massa redireccions");
}

async function readLimitedBody(response: Response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`Document supera ${MAX_BYTES} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Protocol no permès");
  if (url.username || url.password) throw new Error("Credencials a la URL no permeses");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Destinació de xarxa privada no permesa");
}

export function isPrivateAddress(address: string) {
  if (!isIP(address)) return true;
  const normalized = address.toLowerCase();
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
export function cleanText(text: string) { return text.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT); }
function inferMime(pathname: string, bytes: Buffer) { return pathname.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF" ? "application/pdf" : "application/octet-stream"; }

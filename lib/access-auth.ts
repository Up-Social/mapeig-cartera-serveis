export const ACCESS_COOKIE_NAME = "mapeig_access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type SessionPayload = { version: 2; issuedAt: number; expiresAt: number };

async function signature(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return base64Url(String.fromCharCode(...signed));
}

function base64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

export async function createAccessToken(secret: string, issuedAt = Date.now()): Promise<string> {
  const payload: SessionPayload = { version: 2, issuedAt, expiresAt: issuedAt + ACCESS_COOKIE_MAX_AGE * 1000 };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signature(encoded, secret)}`;
}

export async function verifyAccessToken(token: string, secret: string, now = Date.now()): Promise<boolean> {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return false;
  const expectedSignature = await signature(encoded, secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as Partial<SessionPayload>;
    return payload.version === 2 && typeof payload.issuedAt === "number" && typeof payload.expiresAt === "number" && payload.issuedAt <= now + 60_000 && payload.expiresAt > now && payload.expiresAt - payload.issuedAt === ACCESS_COOKIE_MAX_AGE * 1000;
  } catch {
    return false;
  }
}

export async function passwordProof(password: string): Promise<string> {
  return signature("mapeig-cartera-serveis:password:v2", password);
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function safeReturnPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return fetchSite !== "cross-site";
  try {
    const source = new URL(origin);
    const destination = new URL(request.url);
    if (source.origin === destination.origin) return true;
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    return loopback.has(source.hostname) && loopback.has(destination.hostname) && source.protocol === destination.protocol && source.port === destination.port;
  } catch { return false; }
}

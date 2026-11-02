/** A signed CMS signing time is claimed by the signer, not a trusted timestamp.
 * Only use output produced by pdfsig with LC_ALL=C and TZ=UTC. This parser does
 * not run pdfsig, establish certificate trust, or determine the award date. */
export type PdfSignatureDate = {
  claimedUtc: string;
  localDate: string;
  certificateTrust: 'trusted' | 'untrusted' | 'unknown';
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function parsePdfSignatureDate(output: string): PdfSignatureDate | null {
  if (Buffer.byteLength(output, 'utf8') > 256_000) return null;
  const headers = [...output.matchAll(/^Signature #(\d+):\s*$/gm)];
  // Multiple signatures, invalid signatures and partial signatures require a
  // human review: never guess which signer or revision supplies the date.
  if (headers.length !== 1 || headers[0][1] !== '1') return null;
  const section = output.slice(headers[0].index);
  if ((section.match(/^\s*- Signature Validation: Signature is Valid\.\s*$/gm) ?? []).length !== 1 ||
      (section.match(/^\s*- Total document signed\s*$/gm) ?? []).length !== 1) return null;
  const times = [...section.matchAll(/^\s*- Signing Time: (\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*$/gm)];
  if (times.length !== 1) return null;
  const [, monthName, dayText, yearText, hourText, minuteText, secondText] = times[0];
  const month = MONTHS.indexOf(monthName), day = Number(dayText), year = Number(yearText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (month < 0 || year < 1900 || year > 2100 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date);
  const part = (type:string) => parts.find(value => value.type === type)?.value;
  const localDate = `${part('year')}-${part('month')}-${part('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const trust = [...section.matchAll(/^\s*- Certificate Validation: (.+?)\s*$/gm)];
  const certificateTrust = trust.length !== 1 ? 'unknown' :
    trust[0][1] === 'Certificate is Trusted.' ? 'trusted' :
    /(?:isn.t Trusted|not trusted)/i.test(trust[0][1]) ? 'untrusted' : 'unknown';
  return {claimedUtc:date.toISOString(), localDate, certificateTrust};
}

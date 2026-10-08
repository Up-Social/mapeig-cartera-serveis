/** Shared by local Poppler and the cloud sandbox; Markdown never repairs encoding. */
export const EXTRACTION_VERSION = 'readable-markdown-v2';
export const MAX_DOCUMENT_CHARS = 250_000;
export const MAX_OCR_PAGES = 25;
export function textDefects(text: string): string[] {
  const value = text.trim();
  if (!value) return ['empty_text'];
  // pdftotext -layout pads wide annex tables with spaces; assess the content,
  // not the column spacing, before deciding that a page needs OCR.
  const contentLength = value.replace(/\s/g, '').length;
  const controls = (value.match(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufffd]/g) ?? []).length;
  const letters = (value.match(/\p{L}/gu) ?? []).length;
  const symbols = (value.match(/[^\p{L}\p{N}\p{P}\p{Z}\s€%+<>=|]/gu) ?? []).length;
  const digits = (value.match(/\p{N}/gu) ?? []).length;
  const words = value.match(/\p{L}+/gu) ?? [];
  const fragments = words.filter(word => word.length <= 2).length;
  const fragmented = words.length >= 30 && fragments / words.length > .62;
  return controls > 0 || (contentLength > 80 && (symbols / contentLength > .08 || (letters / contentLength < .18 && digits / contentLength < .25))) || fragmented
    ? ['corrupt_text'] : [];
}
export function needsOcr(text: string) { return text.trim().length < 50 || textDefects(text).length > 0; }
export function pdfPages(text: string) {
  const pages = text.replace(/\r/g, '').split('\f');
  if (pages.length > 1 && !pages.at(-1)?.trim()) pages.pop();
  return pages;
}
export type ReadablePage = { page: number; method: 'text' | 'ocr'; text: string; defects: string[] };
export async function recoverPdfText(raw: string, allowOcr: boolean, recognize: (page: number) => Promise<string>, pageCount?: number) {
  const originals = pdfPages(raw);
  const pages: ReadablePage[] = [];
  let usedOcr = 0;
  for (let index = 0; index < Math.max(originals.length, pageCount ?? 0); index++) {
    let text = originals[index] ?? ''; let method: ReadablePage['method'] = 'text';
    if (needsOcr(text) && allowOcr && usedOcr < MAX_OCR_PAGES) {
      text = await recognize(index + 1); method = 'ocr'; usedOcr++;
    }
    // Empty pages are retained in the coverage report and cannot prove a service.
    const defects = textDefects(text);
    pages.push({page:index + 1, method, text:text.trim(), defects});
  }
  const markdown = pages.map(page => `## Pàgina ${page.page}\n\n${page.text}`).join('\n\n');
  const unreadable = pages.some(page => page.defects.some(flag => flag !== 'empty_text'));
  const missing = pages.some(page => !page.text.trim());
  const partial = unreadable || missing || markdown.length > MAX_DOCUMENT_CHARS;
  return {
    text: markdown.slice(0, MAX_DOCUMENT_CHARS), partial,
    method: usedOcr ? 'pdf-ocr-markdown-v2' : 'pdf-text-markdown-v2',
    extraction_version: EXTRACTION_VERSION,
    coverage: {pages:pages.map(({page,method,defects}) => ({page,method,defects})), complete:!partial},
  };
}

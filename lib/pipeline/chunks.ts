import {createHash} from "node:crypto";
const CHUNK_SIZE = 1_200;
const OVERLAP = 180;
export function splitText(text: string) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const boundary = Math.max(paragraph, sentence);
      if (boundary > start + CHUNK_SIZE * 0.6) end = boundary + (boundary === sentence ? 1 : 0);
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - OVERLAP);
  }
  return chunks;
}
export function scoreQuality(length: number, flags: string[]) {
  let score = length >= 3_000 ? 1 : length >= 1_000 ? 0.85 : length >= 300 ? 0.65 : 0.35;
  if (flags.includes("duplicate_text")) score -= 0.25;
  if (flags.includes("basic_html_extraction")) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}
export function normalize(text: string) { return text.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

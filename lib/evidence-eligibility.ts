import { textDefects } from "./pipeline/readable-document";
import { scoreQuality } from "./pipeline/chunks";
import { isUnusableWebExtraction } from "./source-evidence";
import { isGenericPortalText } from "./portal-text";
export { isGenericPortalText } from "./portal-text";

export const EVIDENCE_POLICY_VERSION = "substantive-evidence-v2";

export const EVIDENCE_REJECTION_REASONS = [
  "corrupt_text",
  "incomplete_extraction",
  "generic_portal",
  "short_text",
  "duplicate_text",
  "javascript_shell",
  "basic_html_only",
] as const;

export type EvidenceRejectionReason =
  (typeof EVIDENCE_REJECTION_REASONS)[number];

export type EvidenceQualityInput = {
  content: string;
  textLength?: number | null;
  extractionMethod?: string | null;
  qualityFlags?: string[] | null;
  coverageVerified?: boolean;
};

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function evidenceRejectionReasons(
  input: EvidenceQualityInput,
): EvidenceRejectionReason[] {
  const content = normalizedText(input.content);
  const textLength = input.textLength ?? content.length;
  const flags = input.qualityFlags ?? [];
  const reasons: EvidenceRejectionReason[] = [];

  if (textDefects(input.content).includes("corrupt_text") || flags.includes("corrupt_text")) reasons.push("corrupt_text");
  if (flags.includes("incomplete_extraction") || input.coverageVerified === false) reasons.push("incomplete_extraction");
  if (isUnusableWebExtraction(content)) reasons.push("javascript_shell");
  if (isGenericPortalText(content)) reasons.push("generic_portal");
  if (content.length < 120 || textLength < 300) {
    reasons.push("short_text");
  }
  if (flags.includes("duplicate_text")) reasons.push("duplicate_text");
  if (
    (input.extractionMethod === "html-basic" ||
      flags.includes("basic_html_extraction")) &&
    textLength < 1_000
  ) {
    reasons.push("basic_html_only");
  }

  return [...new Set(reasons)];
}

export function isEligibleEvidence(input: EvidenceQualityInput) {
  return evidenceRejectionReasons(input).length === 0;
}

export function isSubstantiveEvidenceQuote(value: string) {
  const normalized = normalizedText(value);
  return (
    normalized.length >= 24 &&
    textDefects(value).length === 0 &&
    !isGenericPortalText(normalized) &&
    !isUnusableWebExtraction(normalized)
  );
}

export function documentQuality(
  text: string,
  extractionMethod: string,
  duplicate = false,
) {
  const flags: string[] = textDefects(text);
  if (text.trim().length < 1_000) flags.push("short_text");
  if (duplicate) flags.push("duplicate_text");
  if (extractionMethod === "html-basic") flags.push("basic_html_extraction");
  if (isUnusableWebExtraction(text)) flags.push("javascript_shell");
  if (isGenericPortalText(text)) flags.push("generic_portal");
  return {
    qualityScore: scoreQuality(text.trim().length, flags),
    qualityFlags: flags,
  };
}

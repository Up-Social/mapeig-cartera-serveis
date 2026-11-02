type RefreshDocument = {
  document_type?: string | null;
  quality_flags?: readonly string[] | null;
};

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

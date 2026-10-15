/** Migration baseline: keep the non-reasoning workload and Standard pricing explicit. */
export const OPENAI_MIGRATION_MODEL = 'gpt-6-luna';

export function prepareOpenAIRequest<T extends Record<string, unknown>>(body: T): T {
 if (body.model !== OPENAI_MIGRATION_MODEL) return body;
 return {...body, reasoning: {effort: 'none'}, service_tier: 'default'};
}

/** Upper bound for our text-only requests, including schema and framing overhead.
 * UTF-8 bytes bound byte-level tokens; never use the character/4 billing estimate.
 */
export function openAIInputTokenCeiling(body: Record<string, unknown>): number {
 if (typeof body.input !== 'string' || 'tools' in body || 'previous_response_id' in body || 'conversation' in body)
  throw new Error('OPENAI_TEXT_REQUEST_REQUIRED');
 const bound = Buffer.byteLength(JSON.stringify(body), 'utf8') + 4096;
 if (bound > 1_050_000) throw new Error('OPENAI_INPUT_TOO_LARGE');
 return bound;
}

/** Replayed receipts retain the model that actually produced them. */
export function responseModel(response: Record<string, unknown>, requested: string): string {
 return typeof response.model === 'string' && response.model.length ? response.model : requested;
}

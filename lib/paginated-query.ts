import {readPages} from './read-pages';

/** Read all rows in stable order. The caller supplies an order with a unique
 * final key and applies all visibility predicates before range pagination. */
export async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{data: T[] | null; error: unknown}>, size = 500): Promise<T[]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Mida de pàgina invàlida');
  return readPages(page, size);
}

export function chunks<T>(values: readonly T[], size = 100): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Mida de bloc invàlida');
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

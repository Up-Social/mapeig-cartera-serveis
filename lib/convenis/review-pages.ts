import {readPages} from '../read-pages';
type Page<T>=(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>;
/** None of the collections may silently stop at the API's row limit. */
export async function readConveniReviewPages<U,H,C>(units:Page<U>,history:Page<H>,conceptHistory:Page<C>) {
 const [unitRows,reviewRows,conceptRows]=await Promise.all([readPages(units),readPages(history),readPages(conceptHistory)]);
 return {unitRows,reviewRows,conceptRows};
}

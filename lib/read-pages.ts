/** Stable ordering is supplied by the caller; never rely on PostgREST's 1,000-row default. */
export async function readPages<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,size=500):Promise<T[]> {
 const rows:T[]=[];
 for(let from=0;;from+=size){const result=await page(from,from+size-1);if(result.error)throw result.error;const data=result.data??[];rows.push(...data);if(data.length<size)return rows;}
}

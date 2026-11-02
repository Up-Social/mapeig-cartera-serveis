export type ConcertInventoryRow={id:string;source_record_id:string};
type InventoryPage={data:ConcertInventoryRow[]|null;error:unknown;count:number|null};

/** The caller orders by the unique id and requests an exact count on each page.
 * A capped, inconsistent, failed or malformed page must stop the import before
 * it calculates any removals. This is not a transactional snapshot. */
export async function readConcertDiscoveryInventory(
 page:(from:number,to:number)=>PromiseLike<InventoryPage>,
):Promise<ConcertInventoryRow[]>{
 const size=500;const rows:ConcertInventoryRow[]=[];let expected:number|undefined;
 try{
  for(let from=0;;from+=size){
   const result=await page(from,from+size-1);
   if(result.error)throw result.error;
   const total=result.count;
   if(!Array.isArray(result.data)||typeof total!=='number'||!Number.isSafeInteger(total)||total<0)throw Error('INVALID_INVENTORY_PAGE');
   if(expected===undefined)expected=total;
   if(total!==expected)throw Error('INVENTORY_COUNT_CHANGED');
   for(const row of result.data){
    if(typeof row.id!=='string'||typeof row.source_record_id!=='string'||(rows.length>0&&rows[rows.length-1].id>=row.id))throw Error('INVALID_INVENTORY_ORDER');
    rows.push(row);
   }
   if(rows.length>expected)throw Error('INVALID_INVENTORY_COUNT');
   if(result.data.length<size){if(rows.length!==expected)throw Error('INCOMPLETE_INVENTORY');return rows;}
   if(rows.length===expected)return rows;
  }
 }catch(error){throw new Error('No s’ha pogut llegir l’inventari complet de concerts; no es pot continuar.',{cause:error});}
}

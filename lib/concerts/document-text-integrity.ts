import {createHash} from 'node:crypto';

/** Confirms consistency of current database metadata and extracted text only.
 * This does not read or verify the physical Storage object. */
export function currentDocumentTextConsistent(item:Record<string,unknown>):boolean {
 const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 return item.status==='fetched'&&typeof item.storage_path==='string'&&item.storage_path.length>0&&sha(item.storage_sha256)
  &&typeof item.active_extraction_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.active_extraction_id)
  &&typeof item.extracted_text==='string'&&sha(item.extracted_text_hash)
  &&createHash('sha256').update(item.extracted_text).digest('hex')===item.extracted_text_hash;
}

import {createHash} from 'node:crypto';
/** Recompute both stored representations; the transcription still requires
 * human comparison against bytes, because separate hashes do not prove it. */
export function verifiedGeographyCapture(value:{source_bytes:unknown;source_text:unknown;source_sha256:unknown;source_text_sha256:unknown},expectedSourceHash:string){
 if(typeof value.source_bytes!=='string'||!/^\\x(?:[a-f0-9]{2})+$/i.test(value.source_bytes)||typeof value.source_text!=='string')throw Error('CAPTURE_UNAVAILABLE');
 const raw=Buffer.from(value.source_bytes.slice(2),'hex');
 const hash=(content:Uint8Array|string)=>createHash('sha256').update(content).digest('hex');
 if(hash(raw)!==value.source_sha256||value.source_sha256!==expectedSourceHash||hash(value.source_text)!==value.source_text_sha256)throw Error('CAPTURE_HASH_CHANGED');
 return {raw,source_text:value.source_text,source_text_sha256:value.source_text_sha256 as string};
}
/** Bind downloads to the exact proposal shown in the review UI. */
export function requireExpectedGeographyCapture(current:{id:number;source_sha256:string}|null,proposalId:string|null,hash:string|null){
 if(!current||proposalId!==String(current.id)||hash!==current.source_sha256)throw Error('CAPTURE_SELECTION_CHANGED');
}

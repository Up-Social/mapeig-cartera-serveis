/** Stream an already verified, immutable-for-the-request byte buffer.
 * Callers must finish all integrity checks before creating a response: a
 * streamed response cannot retract bytes after its headers have been sent. */
export function streamVerifiedBytes(bytes:Uint8Array):ReadableStream<Uint8Array>{
 let offset=0;
 const chunkSize=64*1024;
 return new ReadableStream<Uint8Array>({
  pull(controller){
   if(offset>=bytes.byteLength){controller.close();return;}
   const end=Math.min(offset+chunkSize,bytes.byteLength);
   controller.enqueue(bytes.subarray(offset,end));offset=end;
  },
 });
}

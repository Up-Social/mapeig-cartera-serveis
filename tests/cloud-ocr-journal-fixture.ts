/** In-memory journal for OCR tests; no provider or database calls. */
const states=new WeakMap<Map<string,unknown>,Map<string,string>>();
export function fakeOcrJournal(journal:Map<string,unknown>,args:Record<string,unknown>){
 let state=states.get(journal);if(!state){state=new Map();states.set(journal,state);}
 const key=`ocr-v2:${args.p_document}:${args.p_source_sha256}:${args.p_page}:dpi${args.p_dpi}:${args.p_extraction_version}`;
 const identity=`${key}:${args.p_snapshot_hash}`;
 if(args.p_action==='document_status'){
  const prefix=`ocr-v2:${args.p_document}:${args.p_source_sha256}:`;
  if([...state.entries()].some(([key,value])=>key.startsWith(prefix)&&value==='started'))return {data:'uncertain',error:null};
  const suffix=`:dpi${args.p_dpi}:${args.p_extraction_version}:${args.p_snapshot_hash}`;
  if([...state.entries()].some(([key,value])=>key.startsWith(prefix)&&key.endsWith(suffix)&&value==='confirmed')||[...journal.keys()].some(key=>key.startsWith(prefix)&&key.endsWith(`:dpi${args.p_dpi}:${args.p_extraction_version}`)))return {data:'existing',error:null};
  return {data:'new',error:null};
 }
 const pagePrefix=`ocr-v2:${args.p_document}:${args.p_source_sha256}:${args.p_page}:`;
 const pending=[...state.entries()].some(([key,value])=>key.startsWith(pagePrefix)&&value==='started');
 const previous=state.get(identity);
 if(args.p_action==='verify'){
  if(pending)return {data:null,error:{message:'OCR_JOURNAL_UNCERTAIN',code:'P0001'}};
  const value=journal.get(key) as {textHash?:string}|undefined;
  return previous==='confirmed'&&value?.textHash===(args.p_value as {textHash?:string})?.textHash?{data:'verified',error:null}:{data:null,error:{message:'OCR_JOURNAL_UNVERIFIED',code:'P0001'}};
 }
 if(args.p_action==='confirm'){
  if(previous!=='started')return {data:null,error:{message:'OCR_JOURNAL_UNCERTAIN'}};
  journal.set(key,args.p_value);state.set(identity,'confirmed');return {data:'confirmed',error:null};
 }
 if(pending)return {data:'uncertain',error:null};
 if(previous==='confirmed'||journal.has(key))return {data:'existing',error:null};
 if(args.p_action==='status')return {data:'new',error:null};
 state.set(identity,'started');return {data:'started',error:null};
}

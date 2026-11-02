import {createHash} from 'node:crypto';

/** Version 1 hashes the parsed JSON value, not the original HTTP bytes.
 * Strings are UTF-8 without Unicode normalization; object keys sort by UTF-8
 * bytes; only safe integer numbers are accepted. Length framing makes the
 * encoding unambiguous. NUL, unpaired surrogates and non-JSON values fail. */
export function historicalCanonicalHash(value:unknown):string {
 const chunks:Buffer[]=[Buffer.from('mapeig-history-v1|','utf8')];
 const active=new WeakSet<object>();
 const ascii=(text:string)=>chunks.push(Buffer.from(text,'ascii'));
 const string=(text:string)=>{
  if(text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))throw new Error('HISTORY_CANONICAL_STRING');
  const bytes=Buffer.from(text,'utf8');ascii(`s${bytes.length}:`);chunks.push(bytes);
 };
 const encode=(item:unknown):void=>{
  if(item===null){ascii('n');return;}
  if(item===true){ascii('t');return;}
  if(item===false){ascii('f');return;}
  if(typeof item==='string'){string(item);return;}
  if(typeof item==='number'){
   if(!Number.isSafeInteger(item))throw new Error('HISTORY_CANONICAL_NUMBER');
   ascii(`i${Object.is(item,-0)?'0':String(item)};`);return;
  }
  if(Array.isArray(item)){
   if(active.has(item))throw new Error('HISTORY_CANONICAL_VALUE');active.add(item);
   ascii(`a${item.length}:`);
   for(let i=0;i<item.length;i++){if(!Object.hasOwn(item,i))throw new Error('HISTORY_CANONICAL_VALUE');encode(item[i]);}
   active.delete(item);
   return;
  }
  if(typeof item==='object'){
   if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw new Error('HISTORY_CANONICAL_VALUE');
   if(active.has(item))throw new Error('HISTORY_CANONICAL_VALUE');active.add(item);
   const object=item as Record<string,unknown>,keys=Object.keys(object).sort((a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8')));
   ascii(`o${keys.length}:`);for(const key of keys){string(key);encode(object[key]);}active.delete(item);return;
  }
  throw new Error('HISTORY_CANONICAL_VALUE');
 };
 encode(value);return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

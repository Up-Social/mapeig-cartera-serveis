import {readFile} from 'node:fs/promises';
import path from 'node:path';
const folders:Record<string,string>={cmaps:'cmaps',fonts:'standard_fonts',wasm:'wasm'};
export async function GET(_request:Request,{params}:{params:Promise<{kind:string;file:string}>}){
 const {kind,file}=await params;
 if(!folders[kind]||!/^[a-zA-Z0-9_.-]+$/.test(file)||file.includes('..'))return new Response(null,{status:404});
 try {const bytes=await readFile(path.join(process.cwd(),'node_modules/pdfjs-dist',folders[kind],file));
  return new Response(bytes,{headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/octet-stream','Cache-Control':'private, max-age=3600'}});
 }catch{return new Response(null,{status:404});}
}

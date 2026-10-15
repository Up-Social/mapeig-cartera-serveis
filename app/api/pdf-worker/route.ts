import {readFile} from 'node:fs/promises';
import path from 'node:path';
export async function GET(){
 const body=await readFile(path.join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));
 return new Response(body,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'private, max-age=3600'}});
}

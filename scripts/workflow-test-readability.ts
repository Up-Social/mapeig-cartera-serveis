/** Real local Poppler + OCR regression. No DB or model calls. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorker} from 'tesseract.js';
import {recoverPdfText,textDefects} from '../lib/pipeline/readable-document';
async function main(){
 const dir='docs/local/implementation-20260930';mkdirSync(dir,{recursive:true});
 const lines=['CONVENIO DE SERVICIOS SOCIALES','Servicio de ayuda a domicilio para personas dependientes.', 'La entidad prestadora realiza apoyo personal y tareas del hogar.', 'El anexo acredita el servicio, las personas destinatarias y el importe.', 'Documento sintetico de prueba. No corresponde a personas reales.'];
 const content='BT /F1 14 Tf 50 780 Td '+lines.map((line,i)=>`${i?'0 -30 Td ':''}(${line}) Tj`).join('\n')+' ET';
 const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Broken def /CMapType 2 def 1 begincodespacerange <20> <7E> endcodespacerange 95 beginbfchar '+Array.from({length:95},(_,i)=>`<${(i+32).toString(16)}> <${i===0?'0020':'0001'}>`).join('\n')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const input=path.join(dir,'corrupt-font-fixture.pdf');writeFileSync(input,pdf);
 execFileSync('pdftotext',['-layout',input,path.join(dir,'corrupt-font-fixture.txt')]);const raw=readFileSync(path.join(dir,'corrupt-font-fixture.txt'),'utf8');assert.ok(textDefects(raw).length);
 let calls=0;const result=await recoverPdfText(raw,true,async page=>{calls++;const prefix=path.join(dir,'corrupt-font-page');execFileSync('pdftoppm',['-png','-r','200','-f',String(page),'-l',String(page),'-singlefile',input,prefix]);const worker=await createWorker(['cat','spa'],undefined,{cachePath:path.join(tmpdir(),'mapeig-tesseract-cache')});try{return (await worker.recognize(prefix+'.png')).data.text;}finally{await worker.terminate();}},1);
 assert.equal(calls,1);assert.equal(result.partial,false);assert.match(result.text,/ayuda a domicilio/i);assert.deepEqual(textDefects(result.text),[]);
 writeFileSync(path.join(dir,'recovered-font-fixture.md'),result.text);writeFileSync(path.join(dir,'readability-result.json'),JSON.stringify({passed:true,synthetic:true,engine:'Poppler + Tesseract.js cat/spa',rawDefects:textDefects(raw),...result.coverage,method:result.method},null,2));
 console.log('PASS real font-map corruption recovered using local OCR; Markdown, legibility and page provenance verified');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

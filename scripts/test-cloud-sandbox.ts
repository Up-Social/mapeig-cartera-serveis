import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
async function main(){
 const snapshot=process.env.CLOUD_SANDBOX_SNAPSHOT;if(!snapshot)throw Error();
 const sb=await Sandbox.create({source:{type:'snapshot',snapshotId:snapshot},resources:{vcpus:1},networkPolicy:'deny-all',timeout:180_000});
 try{
  const text='Document sintetic de prova. Servei social per a persones. Cap dada real.';
  const stream=`BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await sb.writeFiles([{path:'/tmp/fixture.pdf',content:Buffer.from(pdf)}]);
  assert.equal((await sb.runCommand('pdftotext',['/tmp/fixture.pdf','/tmp/result.txt'])).exitCode,0);
  assert.ok((await sb.readFileToBuffer({path:'/tmp/result.txt'}))?.toString().includes('Servei social'));
  assert.equal((await sb.runCommand('pdftoppm',['-png','-r','200','-singlefile','/tmp/fixture.pdf','/tmp/page'])).exitCode,0);
  assert.equal((await sb.runCommand('tesseract',['/tmp/page.png','/tmp/ocr','-l','cat+spa'],{timeoutMs:120_000})).exitCode,0);
  assert.ok((await sb.readFileToBuffer({path:'/tmp/ocr.txt'}))?.toString().includes('Servei social'));
  console.log('Synthetic PDF extraction and Catalan/Spanish OCR passed in remote Sandbox.');
 }finally {await sb.stop();}
}
main().catch(()=>{console.error('SANDBOX_TEST_FAILED');process.exitCode=1});

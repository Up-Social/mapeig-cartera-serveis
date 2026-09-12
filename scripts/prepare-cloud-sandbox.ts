import {Sandbox} from '@vercel/sandbox';
// Run once with Vercel credentials; no application/AI keys enter the VM.
async function main(){
 const sb=await Sandbox.create({resources:{vcpus:1},timeout:600_000});
 try {
  const install=await sb.runCommand({cmd:'sudo',args:['sh','-c','apt-get update -qq && apt-get install -y -qq poppler-utils tesseract-ocr tesseract-ocr-cat tesseract-ocr-spa'],});
  if(install.exitCode!==0)throw new Error('SANDBOX_INSTALL');
  const languages=await sb.runCommand('tesseract',['--list-langs']);
  const list=await languages.stdout();if(!list.includes('cat')||!list.includes('spa'))throw new Error('SANDBOX_LANGUAGES');
  const versions=await sb.runCommand('sh',['-c','dpkg-query -W poppler-utils tesseract-ocr tesseract-ocr-cat tesseract-ocr-spa']);
  console.log(await versions.stdout());
  const snapshot=await sb.snapshot({expiration:0});
  console.log('CLOUD_SANDBOX_SNAPSHOT='+snapshot.snapshotId);
 }finally {try{await sb.stop();}catch{}}
}
main().catch((e:unknown)=>{console.error('SANDBOX_PREPARATION_FAILED',{status:(e as {status?:number}).status,code:(e as {code?:string}).code});process.exitCode=1});

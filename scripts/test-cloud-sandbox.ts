import {createEphemeralSandbox} from '../lib/cloud/sandbox';
import {verifySyntheticDocuments} from '../lib/cloud/sandbox-synthetic';
async function main(){
 const snapshot=process.env.CLOUD_SANDBOX_SNAPSHOT;if(!snapshot)throw Error();
 const handle=await createEphemeralSandbox('synthetic',snapshot);
 try {
  await verifySyntheticDocuments(handle.session);
 } finally { await handle.close(); }
 console.log('Synthetic digital PDF extraction and image-only PDF Catalan/Spanish OCR passed; remote Sandbox closed without a snapshot.');
}
main().catch(()=>{console.error('SANDBOX_TEST_FAILED');process.exitCode=1});

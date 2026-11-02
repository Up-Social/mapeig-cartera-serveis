import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUnitCopyIdentity} from '../lib/convenis/unit-copy-identity';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const digest='a'.repeat(64),recordId=id(1),unitId=id(2),doc=id(3);
const monetaryCitation={document_id:doc,page:4,quote:'Aportació econòmica del conveni'};
const source={path:`cases/${recordId}/documents/${doc}/${digest}.pdf`,sha256:digest,object_id:id(4),version:id(5)};
const copy={path:`cases/${recordId}/items/${unitId}/documents/${doc}/${digest}.pdf`,sha256:digest,object_id:id(6),version:id(7)};
const input={recordId,unitId,monetaryCitation,source,copy};
test('binds the unit copy to the monetary citation, not a different first evidence document',()=>{
 assert.deepEqual(checkUnitCopyIdentity(input),input);
 assert.throws(()=>checkUnitCopyIdentity({...input,monetaryCitation:{...monetaryCitation,document_id:id(8)}}),/cita econòmica/);
});
test('rejects other units, records, documents, hashes and aliased objects',()=>{
 for(const candidate of [
  {...input,unitId:id(8)}, {...input,recordId:id(8)},
  {...input,copy:{...copy,path:copy.path.replace(doc,id(8))}},
  {...input,copy:{...copy,sha256:'b'.repeat(64)}},
  {...input,copy:{...copy,object_id:source.object_id}},
  {...input,source:{...source,version:''}},
  {...input,copy:{...copy,path:copy.path+'?versionId=evil'}},
 ]) assert.throws(()=>checkUnitCopyIdentity(candidate));
});
test('successful identity comparison does not claim verified bytes or approval',()=>{
 const checked=checkUnitCopyIdentity(input);
 assert.equal('approved' in checked,false);
 assert.equal('bytesVerified' in checked,false);
});

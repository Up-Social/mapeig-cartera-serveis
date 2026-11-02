import {isUuid} from '../uuid';
import {itemSourcePath} from '../source-storage';
import type {Citation} from './contract';

type CopyReceipt={path:string;sha256:string;object_id:string;version:string};
type CopyIdentity={recordId:string;unitId:string;monetaryCitation:Citation;source:CopyReceipt;copy:CopyReceipt};

/** Checks declared identity only. This does not read, copy, or certify bytes;
 * a trusted verifier and a transactional fence are still required. */
export function checkUnitCopyIdentity(input:CopyIdentity):CopyIdentity {
 const {recordId,unitId,monetaryCitation,source,copy}=input;
 const documentId=monetaryCitation?.document_id;
 if(typeof recordId!=='string'||!isUuid(recordId)||typeof unitId!=='string'||!isUuid(unitId)
  ||typeof documentId!=='string'||!isUuid(documentId))throw Error('Identitat de la unitat o de la cita econòmica invàlida');
 for(const receipt of [source,copy]){
  if(!receipt||typeof receipt.path!=='string'||typeof receipt.sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sha256)
   ||typeof receipt.object_id!=='string'||!isUuid(receipt.object_id)||typeof receipt.version!=='string'||!isUuid(receipt.version))
   throw Error('Identitat o versió documental invàlida');
 }
 if(!new RegExp(`^cases/${recordId}/documents/${documentId}/${source.sha256}\\.[a-z0-9]+$`).test(source.path)
  ||copy.path!==itemSourcePath(recordId,unitId,documentId,source.path)
  ||copy.sha256!==source.sha256||copy.object_id===source.object_id)
  throw Error('La còpia no correspon al document de la cita econòmica');
 return {recordId,unitId,monetaryCitation:{...monetaryCitation},source:{...source},copy:{...copy}};
}

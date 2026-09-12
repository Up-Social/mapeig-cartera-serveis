/** Offline, reproducible conversion of the public PJC documentPJC response. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateCatalog, type OfficialService} from '../lib/official-catalog';
const [input,affectations] = process.argv.slice(2);
if(!input || !affectations) throw new Error('Ús: prepare-official-catalog.ts document.json affectations.json');
const raw=readFileSync(input,'utf8'); const doc=JSON.parse(raw);
const changes=JSON.parse(readFileSync(affectations,'utf8'));
const entities:Record<string,string>={eacute:'é',rsquo:'’',oacute:'ó',ograve:'ò',uacute:'ú',iacute:'í',agrave:'à',egrave:'è',uuml:'ü',iuml:'ï',ccedil:'ç',ndash:'–',middot:'·',nbsp:' ',Ograve:'Ò',euro:'€',quot:'"',Agrave:'À',ordf:'ª',Eacute:'É',Oacute:'Ó',Egrave:'È',Iacute:'Í',Uacute:'Ú',amp:'&',lt:'<',gt:'>'};
function text(s:string=''):string {return (s??'').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&([a-zA-Z]+);/g,(_,n)=>{if(!(n in entities))throw Error(`Unknown entity ${n}`);return entities[n];}).replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
const annex=doc.bodyDocument.find((s:{title:string})=>s.title==='Annex 1');
const versionId=`pjc-557820-${doc.uriELI.validity}`;
const index=text(annex.text.split('<table')[0]);
const services:OfficialService[]=index.split('\n').flatMap(line=>{const m=line.match(/^([123](?:\.\d+)*)\.?\s+(.+)$/);return m?[{version_id:versionId,service_code:m[1],service_name:m[2],parent_code:m[1].includes('.')?m[1].slice(0,m[1].lastIndexOf('.')):null,benefit_type:({'1':'service','2':'economic','3':'technological'} as const)[m[1][0] as '1'|'2'|'3'],description:'',target_population:'',conditions:'',legal_reference:`https://portaljuridic.gencat.cat/ca/document-del-pjur/?documentId=557820&validity=${doc.uriELI.validity}&traceability=02`,normative_fields:{}}]:[];});
for(const table of annex.text.match(/<table\b[\s\S]*?<\/table>/gi)??[]) {
 const fields:Record<string,string>={};
 for(const row of table.match(/<tr\b[\s\S]*?<\/tr>/gi)??[]) {const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]));if(cells.length===2)fields[cells[0]]=cells[1];}
 const code=fields['Prestació']?.match(/^([123](?:\.\d+)+)/)?.[1];
 if(!code && Object.values(fields).every(v=>!v)) continue;
 if(!code)throw Error('Fitxa sense codi '+JSON.stringify(fields).slice(0,500));const s=services.find(s=>s.service_code===code);if(!s)throw Error(`Fitxa no indexada ${code}`);
 s.normative_fields=fields;
 s.description=Object.entries(fields).filter(([k])=>/Descripció|Objecte|Funcions/.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
 s.target_population=Object.entries(fields).filter(([k])=>/població|edat/i.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
 if (!s.target_population && /població destinatària/.test(s.description)) s.target_population=s.description;
 s.conditions=Object.entries(fields).filter(([k])=>/Criteris|Tipologia|Forma|Garantia/.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
}
const repeal=changes.affectations?.passiveAffectations?.affectationList?.find((a:{type_affectation:string;description_affect:string;description_document:{documentId:string}})=>a.type_affectation==='derogats' && a.description_affect.includes('1.2.4') && a.description_document.documentId==='913592');
const withdrawn=services.filter(s=>s.service_code==='1.2.4'||s.service_code.startsWith('1.2.4.'));
if(!repeal)throw Error('Cal verificar la derogació 1.2.4');
for(const s of withdrawn)services.splice(services.indexOf(s),1);
let validationError: string | null=null; try {validateCatalog(services);} catch(error) {validationError=String(error);}
const download=doc.linkDownloads.linkDownloadPublishedDocumentIndex;
const date=new URL(download).searchParams.get('versionDate')!.split('/').reverse().join('-');
const legalNotice='Text consolidat de consulta del Portal Jurídic, sense caràcter oficial. Les publicacions del DOGC són la font normativa oficial. Validació estructural automatitzada; no certifica compliment legal d’un expedient.';
function section(s:{title:string,text:string,children?:unknown[]}):string{return `## ${text(s.title)}\n\n${text(s.text)}\n\n${(s.children??[]).map(c=>section(c as typeof s)).join('\n')}`;}
const general=doc.bodyDocument.filter((s:{title:string})=>s.title!=='Annex 1').map(section).join('\n');
const version={id:versionId,source_url:doc.uriELI.link,publication_url:'https://portaldogc.gencat.cat/utilsEADOP/PDF/5738/1136960.pdf',retrieved_at:new Date().toISOString(),version_date:date,content_hash:createHash('sha256').update(raw).digest('hex'),legal_notice:legalNotice,general_context:general,provenance:{document:doc.documentData,downloads:doc.linkDownloads,affectations:changes,withdrawn_entries:withdrawn,withdrawal_basis:repeal,validation_error:validationError},entry_count:services.length,validated:!validationError,active:!validationError};
mkdirSync('data/legal',{recursive:true});
writeFileSync('data/legal/cartera.json',JSON.stringify({version,services},null,2)+'\n');
writeFileSync('data/legal/cartera.md',`# ${doc.titleDocument}\n\n${legalNotice}\n\nFont: ${version.source_url}\nVersió: ${date} (${versionId})\nConsulta: ${version.retrieved_at}\nSHA256 resposta: ${version.content_hash}\n\n${doc.bodyDocument.map(section).join('\n')}`);
console.log(`${services.length} entrades extretes · ${date}`);
if(validationError){console.error(validationError);process.exitCode=1;}

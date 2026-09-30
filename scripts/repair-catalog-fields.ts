/** Rebuild continuation rows from the complete, versioned Markdown already in the repo. No network/DB writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateCatalog,type OfficialService} from '../lib/official-catalog';
const file='data/legal/cartera.json';const snapshot=JSON.parse(readFileSync(file,'utf8'));
if(snapshot.version.provenance?.parser_version==='normative-fields-v2'){console.log('Normative fields v2 already repaired; existing provenance preserved');process.exit(0);}
const markdown=readFileSync('data/legal/cartera.md','utf8');
const labels=new Set<string>(snapshot.services.flatMap((s:OfficialService)=>Object.keys(s.normative_fields)).filter(Boolean));
let repaired=0;const modified:string[]=[];
for(const block of markdown.split(/\nPrestació\n\n/).slice(1)) {
 const paragraphs=block.split('\n\n').map(p=>p.trim());const code=paragraphs[0].match(/^([123](?:\.\d+)+) /)?.[1];
 const service=snapshot.services.find((s:OfficialService)=>s.service_code===code);if(!service)continue;
 const fields:Record<string,string>={Prestació:paragraphs[0]};let key='Prestació';
 for(const p of paragraphs.slice(1)) {if(p.startsWith('## '))break;if(labels.has(p)){key=p;fields[key]??='';}else fields[key]+=(fields[key]?'\n\n':'')+p;}
 for(const [label,value]of Object.entries(service.normative_fields) as [string,string][]) {
  if(label && value && !fields[label]?.replace(/\s+/g,' ').includes(value.replace(/\s+/g,' ')))throw Error(`Field not preserved: ${code} ${label}`);
 }
 if(JSON.stringify(fields)!==JSON.stringify(service.normative_fields)){repaired++;modified.push(code!);}
 service.normative_fields=fields;
 service.description=Object.entries(fields).filter(([k])=>/Descripció|Objecte|Funcions/.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
 service.target_population=Object.entries(fields).filter(([k])=>/població|edat/i.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n')||service.target_population;
 service.conditions=Object.entries(fields).filter(([k])=>/Criteris|Tipologia|Forma|Garantia/.test(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
}
validateCatalog(snapshot.services);
const old=snapshot.version.id;const id=old.replace(/-fields-v2$/,'')+'-fields-v2';
snapshot.version.id=id;snapshot.version.provenance={...snapshot.version.provenance,parser_version:'normative-fields-v2',previous_catalog:old,markdown_sha256:createHash('sha256').update(markdown).digest('hex'),repaired_service_codes:modified};
for(const service of snapshot.services)service.version_id=id;
writeFileSync(file,JSON.stringify(snapshot,null,2)+'\n');console.log(`${repaired} complete normative sheets preserved in ${id}`);

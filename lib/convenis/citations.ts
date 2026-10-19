import type {Citation,ConveniAnalysis,DocumentEvidence} from './contract';
export const CONVENI_CITATION_VERSION='conveni-literal-spans-v1';
export type LiteralSpan=Citation&{id:string};
/** Index contiguous original text. IDs let the model select evidence without retyping it. */
export function indexConveniCitations(documents:DocumentEvidence[]) {
 const spans:LiteralSpan[]=[];
 const annotated=documents.map(document=>{
  const pages=[...document.extracted_text.matchAll(/^## Pàgina (\d+)\s*\n([\s\S]*?)(?=^## Pàgina \d+\s*$|$(?![\s\S]))/gm)];
  const source=pages.length?pages.map(m=>({page:Number(m[1]),text:m[2]})):[{page:1,text:document.extracted_text}];
  const text=source.map(({page,text})=>{
   const pieces=[];
   for(let offset=0;offset<text.length;){
    let end=Math.min(offset+700,text.length);
    if(end<text.length){const newline=text.lastIndexOf('\n',end);if(newline>offset+200)end=newline+1;}
    // Include a short final tail in the previous span rather than dropping source text.
    if(text.length-end<12)end=text.length;
    const quote=text.slice(offset,end).trim();offset=end;
    if(!quote)continue;
    if(quote.length<12){pieces.push(quote);continue;}
    const id=`Q${spans.length+1}`;spans.push({id,document_id:document.id,page,quote});pieces.push(`[${id}]\n${quote}`);
   }
   return `## Pàgina ${page}\n\n${pieces.join('\n\n')}`;
  }).join('\n\n');
  return {...document,extracted_text:text};
 });
 return {spans,documents:annotated};
}
export function resolveConveniCitations(input:unknown,spans:LiteralSpan[]):ConveniAnalysis {
 const result=structuredClone(input) as ConveniAnalysis;
 if(!result||!Array.isArray(result.actors)||!Array.isArray(result.units))throw Error('Resposta de conveni incompleta');
 const byId=new Map(spans.map(span=>[span.id,span]));
 for(const item of [...result.actors,...result.units,...result.units.flatMap(u=>u.social_assessment?[u.social_assessment]:[])]){
  if(!Array.isArray(item.evidence)||!item.evidence.length)throw Error('Evidència literal absent');
  item.evidence=(item.evidence as unknown[]).map(id=>{
   if(typeof id!=='string'||!byId.has(id))throw Error('Identificador de cita desconegut');
   const {document_id,page,quote}=byId.get(id)!;return {document_id,page,quote};
  });
 }
 return result;
}

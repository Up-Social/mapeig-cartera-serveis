/** A catalogue proposal only: this does not modify the printed service code,
 * review status or financing. The caller must independently establish that
 * the support observation belongs to the line and use an active catalogue. */
export type ConcertSupportCodeProposal={
 code:string;name:string;parentCode:string;support:'STOI'|'STOAI';
 explanation:string;requiresHumanReview:true;
};
type CatalogueService={code:string;name:string};
export function proposeConcertSupportCode(parentCode:string|null,support:string|null,catalogue:readonly CatalogueService[]):ConcertSupportCodeProposal|null{
 if(parentCode!=='1.2.6.2.4.1'&&parentCode!=='1.2.6.3.4.1')return null;
 if(support!=='STOI'&&support!=='STOAI')return null;
 const code=`${parentCode}.${support==='STOI'?'1':'2'}`;
 const matches=catalogue.filter(item=>item.code===code);
 if(matches.length!==1||typeof matches[0].name!=='string'||!matches[0].name.trim())return null;
 const name=matches[0].name;
 const normalized=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll('·','').replace(/[^a-z0-9]+/g,' ').trim();
 const population=parentCode==='1.2.6.2.4.1'?'discapacitat intellectual':'discapacitat fisica';
 if(!normalized.includes('terapia ocupacional')||!normalized.includes(population))return null;
 const hasAuxiliary=/\bauxiliar\b/.test(normalized);
 if(support==='STOAI'&&(!/\bamb auxiliar$/.test(normalized)||/\b(?:sense|no|excepte)\b/.test(normalized)))return null;
 if(support==='STOI'&&hasAuxiliary&&!/\bsense auxiliar$/.test(normalized))return null;
 if(support==='STOI'&&/\bamb auxiliar\b/.test(normalized))return null;
 return {code,name,parentCode,support,requiresHumanReview:true,
  explanation:`Proposta derivada del codi agrupador i del suport ${support}; cal contrastar la línia i el document abans de confirmar-la.`};
}

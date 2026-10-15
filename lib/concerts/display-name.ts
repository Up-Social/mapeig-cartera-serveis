export const concertUnitName=(unit:{provider_name?:string|null;observed_provider_name?:string|null;recovered_provider_name?:string|null})=>unit.provider_name??unit.recovered_provider_name??unit.observed_provider_name??'Entitat pendent de contrast';
export const concertLineHref=(recordId:string,unitId:string)=>`/records/${recordId}#concert-line-${unitId}`;
export const concertLinkHref=(recordId:string,linkId:string)=>`/records/${recordId}#concert-link-${linkId}`;

/** Only predecessor candidates/confirmations belong in a rectification selector. */
export function concertPredecessorIds(unitId:string,links:Array<{later_unit_id:string;earlier_unit_id:string;status:string}>):Set<string>{
 const preceding=new Set<string>(),queue=[unitId];
 while(queue.length){const current=queue.shift()!;for(const link of links.filter(l=>l.later_unit_id===current&&['candidate','confirmed'].includes(l.status))){if(link.earlier_unit_id!==unitId&&!preceding.has(link.earlier_unit_id)){preceding.add(link.earlier_unit_id);queue.push(link.earlier_unit_id);}}}
 return preceding;
}

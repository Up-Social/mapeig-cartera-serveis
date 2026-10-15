export const concertUnitName=(unit:{provider_name?:string|null;observed_provider_name?:string|null;recovered_provider_name?:string|null})=>unit.provider_name??unit.recovered_provider_name??unit.observed_provider_name??'Entitat pendent de contrast';
export const concertLineHref=(recordId:string,unitId:string)=>`/records/${recordId}#concert-line-${unitId}`;
export const concertLinkHref=(recordId:string,linkId:string)=>`/records/${recordId}#concert-link-${linkId}`;

/** A narrow, title-backed decision. Mixed and generic titles continue to PDF analysis. */
export function concertNoAwardTitle(title:string):{kind:'denial'|'proposal'|'call'|'vacant'|'spending';explanation:string}|null{
 const value=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 if(/\b(adjudic|provisi[oó] directa|assignaci[oó] de places|prorrog)/.test(value))return null;
 if(/^(?:resolucio|acord)\b.{0,120}\bdenegaci[oó]n?\b/.test(value)||/\bplaces denegades\b/.test(value))
  return {kind:'denial',explanation:'La resolució denega la sol·licitud o les places indicades i no adjudica cap concert nou.'};
 if(/^(?:acord|resolucio)\b.{0,100}\bproposta\b|^proposta\s+de\s+resolucio\b/.test(value))
  return {kind:'proposal',explanation:'Aquest acte és una proposta prèvia: la provisió requereix una resolució definitiva.'};
 if(/\bconvocatoria\b/.test(value))
  return {kind:'call',explanation:'La convocatòria obre el procediment però no adjudica cap servei a una entitat.'};
 if(/\bplaces desertes\b/.test(value))
  return {kind:'vacant',explanation:'Les places declarades desertes no s’han adjudicat en aquest acte.'};
 if(/\bautoritzacio (?:de |de la )?despesa\b/.test(value))
  return {kind:'spending',explanation:'L’autorització comptable no acredita per si sola una provisió nova.'};
 return null;
}

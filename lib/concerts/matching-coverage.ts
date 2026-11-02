type CoverageRecord={financingType:string;analysis?:{rules_version:string}|null};
export type MatchingCoverageUnit={act_type:string;status:string;service_code:string|null;effective_service_code?:string|null;observed_service_code:string|null};

/** Counts the complete loaded set, not the visible page or model alternatives.
 * This is a presentation warning; it establishes no service or financial fact. */
export function generalConcertMatchingCoverage(record:CoverageRecord,units:ReadonlyArray<MatchingCoverageUnit>):number|null{
 // Positively identify the general route. An early title/evidence decision or
 // an unfamiliar rule version is not proof that general matching ran.
 if(record.financingType!=='concert'||!record.analysis||!['evidence-roles-v1','evidence-roles-v2','evidence-roles-v3','evidence-roles-v4','leaf-normative-v1'].includes(record.analysis.rules_version))return null;
 const codes=new Set(units.filter(unit=>unit.act_type==='award'&&unit.status!=='rejected')
  // Keep the same precedence as the existing line cards. The API supplies
  // current valid corrections through effective_service_code; a prepared
  // service_code still takes precedence, as it does in the displayed card.
  .map(unit=>(unit.service_code??unit.effective_service_code??unit.observed_service_code)?.trim()).filter((code):code is string=>!!code));
 return codes.size>3?codes.size:null;
}

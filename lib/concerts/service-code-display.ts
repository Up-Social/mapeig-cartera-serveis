/** Preserve the documentary observation and a prepared historical value separately. */
export function concertServiceCodeDisplay(unit:{service_code:string|null;observed_service_code:string|null;service_code_correction?:{value:string;valid:boolean}|null}){
 const correction=unit.service_code_correction;
 const stale=correction?.valid===false;
 const code=stale?unit.observed_service_code:(correction?.valid?correction.value:unit.service_code??unit.observed_service_code);
 return {code,observed:unit.observed_service_code,correction:correction?.value??null,stale,prepared:unit.service_code};
}

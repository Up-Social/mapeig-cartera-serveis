import type {OfficialService} from '../official-catalog';

/** Only the printed service typology is interpreted. Provider/centre names never select a code. */
export function programServiceCode(typology:string|null,catalog:OfficialService[]):string|null {
 const value=(typology??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const elderly=/gent gran/.test(value), intellectual=/intel[·. ]*lectual/.test(value), physical=/fisic/.test(value), mental=/mental/.test(value);
 if([elderly,intellectual,physical,mental].filter(Boolean).length>1)return null;
 let code:string|null=null;
 if(elderly){
  if(/centre de dia/.test(value))code='1.2.3.1';
  else if(/residencia assistida/.test(value))code='1.2.3.3.2';
  else if(/tutela/.test(value))code='1.2.3.6';
 } else if(intellectual||physical){
  const family=intellectual?'1.2.6.2':'1.2.6.3';
  if(/autonomia.*(?:propia llar|llar)/.test(value))code=family+'.2';
  else if(/centre de dia/.test(value))code=family+'.1';
  else if(/llar residencia/.test(value))code=family+'.3.2';
  else if(/centre residencial/.test(value))code=family+'.3.3';
  else if(/terapia.*ocupacional/.test(value))code=family+'.4.1';
  else if(/ocupacional.*insercio/.test(value))code=family+'.4.2';
  else if(intellectual&&/tutela/.test(value))code=family+'.6';
 } else if(mental){
  if(/autonomia/.test(value))code='1.2.7.1';
  else if(/llar.*suport/.test(value))code='1.2.7.2.1';
  else if(/llar residencia/.test(value))code='1.2.7.2.2';
  else if(/tutela/.test(value))code='1.2.7.6';
 }
 if(/club social/.test(value))code=/modul a.*modul b/.test(value)?'1.2.7.4':/modul a/.test(value)?'1.2.7.4.1':/modul b/.test(value)?'1.2.7.4.2':'1.2.7.4';
 if(/drogodepend|addiccion/.test(value)){
  if(/centre de dia/.test(value))code='1.2.8.2.1';
  else if(/pis.*suport/.test(value))code='1.2.8.2.2';
  // A residential centre is not silently equated to a therapeutic community.
 }
 if(/vih|sida/.test(value)){
  if(/llar.*suport/.test(value))code='1.2.9.2.1';
  else if(/llar residencia/.test(value))code='1.2.9.2.2';
 }
 if(/^servei prelaboral\s*$/.test(value))code='1.2.7.5';
 return code&&catalog.some(s=>s.service_code===code&&s.benefit_type==='service')?code:null;
}

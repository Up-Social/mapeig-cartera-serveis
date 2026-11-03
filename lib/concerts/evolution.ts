import {economicConcertTerritory,type ReviewedConcertGeography} from './supplemental-geography-projection';
import {concertUnitName} from './display-name';
import {projectConcertBalances,type ConcertFinancialLine} from './financial-ledger';
export type EconomicUnit={
 supplemental_geography?:ReviewedConcertGeography|null;
 document_identity?:string;recovered_provider_name?:string|null;recovered_service_name?:string|null;line_award_state?:'current'|'stale';
 id:string;source_record_id:string;unit_key:string;act_type:string;status:string;source_fingerprint:string;
 provider_name:string|null;observed_provider_name:string|null;provider_nif:string|null;reses_code:string|null;
 service_code:string|null;observed_service_code:string|null;territory:string|null;period:string|null;
 amount:number|string|null;effective_start:string|null;effective_end:string|null;horizon_state:string|null;
 document_id:string|null;page:number|null;storage_path:string|null;storage_sha256:string|null;evidence_quote:string|null;
};
export type Annuality={start:string;end:string;amountCents:number};
export type EconomicReview={annualities?:Annuality[];unit_id:string;version:number;status:'draft'|'approved'|'excluded';source_fingerprint:string;expected_job_id:string;
 operation:ConcertFinancialLine['operation']|'correction';amount_cents:number|null;amount_kind:'exact'|'maximum'|'unknown';
 period_start:string|null;period_end:string|null;effective_at:string|null;funder:string|null;corrects_unit_id:string|null;
 evidence_quote:string;review_note:string;};
export type EconomicLink={id:string;later_unit_id:string;earlier_unit_id:string;root_unit_id:string;status:string;version:number;evidence:string;relation_kind:string;review_note:string|null};
export type EconomicPublication={id:string;title:string;job_id:string|null;job_status:string|null;official_url:string|null};
export type MissingConcertLines={earlier_record_id:string;later_record_id:string;evidence:string};
export type ConcertEvolutionData={missingLines?:MissingConcertLines[];units:EconomicUnit[];reviews:EconomicReview[];links:EconomicLink[];publications:EconomicPublication[]};
export type EvolutionMovement={territory?:string|null;supplementalGeography?:ReviewedConcertGeography|null;unitId:string;recordId:string;rootId:string|null;provider:string;operation:string;period:string;amountCents:number|null;amountKind:EconomicReview['amount_kind'];
 status:'reviewed'|'pending'|'excluded';issues:string[];effectiveAt:string|null;beforeCents?:number|null;afterCents?:number|null};
export type EvolutionBalance={rootId:string;rootIds:string[];providerNif:string|null;provider:string;service:string;territory:string;period:string;funder:string;amountCents:number|null;maximum:boolean;issues:string[]};
export const ECONOMIC_RULES_VERSION='concert-economics-2024-v5';
export const ECONOMIC_AMOUNT_LABELS={exact:'Import documental',maximum:'Màxim autoritzat · no és despesa real',unknown:'Import no acreditat'};
const name=concertUnitName;
const excluded=(u:EconomicUnit)=>['out_of_scope','pre_2024_origin_unavailable'].includes(u.horizon_state??'');
const agreementIdentity=(u:EconomicUnit)=>[u.document_identity??u.storage_sha256,u.unit_key.startsWith('official-annex:')?u.unit_key.split(':').slice(2).join(':'):u.evidence_quote,u.page].join('|');
const iso=(s:string|null):s is string=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export const isConcertCutoff=(value:string):boolean=>iso(value);
/** Parse euros without binary multiplication or rounding away invalid precision. */
export function euroCents(value:string|number|null):number|null{
 if(value===null||value==='')return null;
 const m=String(value).match(/^(-?)(\d+)(?:[.,](\d{1,2}))?$/);if(!m)return null;
 const cents=(BigInt(m[2])*BigInt(100)+BigInt((m[3]??'').padEnd(2,'0')))*(m[1]?-BigInt(1):BigInt(1));
 return cents<=BigInt(Number.MAX_SAFE_INTEGER)&&cents>=BigInt(Number.MIN_SAFE_INTEGER)?Number(cents):null;
}

/** One projection for the UI and both Excel sheets. Never promotes source drafts. */
/** Lines of the same unit that only differ in their start date within one
 * year (for example two tutelages starting days apart) form one consolidated
 * row; the earliest start is kept. Other periods stay separate. */
export function consolidatedPeriodKey(period:string){
 const match=period.match(/^(\d{4})-\d{2}-\d{2}\/(\d{4}-\d{2}-\d{2})$/);
 return match&&match[2].startsWith(match[1])?`${match[1]}:${match[2]}`:period;
}
export function concertEvolution(data:ConcertEvolutionData,cutoff:string){
 if(!iso(cutoff))throw Error('Data de tall no vàlida');
 // Resolve a display/projection copy only; source fingerprints and persisted
 // adjudications remain the exact evidence that the economic reviewer saw.
 const economicReviewByUnit=new Map(data.reviews.map(r=>[r.unit_id,r]));
 const territoryStates=new Map(data.units.map(u=>[u.id,economicConcertTerritory(u.territory,u.supplemental_geography,economicReviewByUnit.get(u.id))]));
 data={...data,units:data.units.map(u=>({...u,territory:territoryStates.get(u.id)!.territory}))};
 const byId=new Map(data.units.map(u=>[u.id,u]));
 const reviews=new Map(data.reviews.map(r=>[r.unit_id,r]));
 const publications=new Map(data.publications.map(p=>[p.id,p]));
 const parents=new Map<string,EconomicLink[]>();
 for(const l of data.links.filter(l=>l.status==='confirmed'))parents.set(l.later_unit_id,[...(parents.get(l.later_unit_id)??[]),l]);
 const chain=(id:string):{root:string|null;path:string[];issue?:string}=>{
  const path:string[]=[];let cursor=id;
  while(true){
   if(path.includes(cursor))return {root:null,path,issue:'Cicle en la cadena'};
   path.push(cursor);const u=byId.get(cursor);if(!u)return {root:null,path,issue:'Falta una línia de la cadena'};
   if(excluded(u))return {root:null,path,issue:'Origen anterior a 2024 o fora de l’horitzó'};
   const p=parents.get(cursor)??[];
   if(p.length>1)return {root:null,path,issue:'Diversos originals confirmats incompatibles'};
   if(!p.length)return u.act_type==='award'?{root:cursor,path}:{root:null,path,issue:'Falta confirmar l’original'};
   if(u.act_type==='award')return {root:null,path,issue:'Una adjudicació inicial té predecessor'};
   cursor=p[0].earlier_unit_id;
  }
 };
 const movements:EvolutionMovement[]=[],accepted:ConcertFinancialLine[]=[];
 const affected=new Map<string,Set<string>>();
 const block=(root:string,issue:string)=>{if(!affected.has(root))affected.set(root,new Set());affected.get(root)!.add(issue);};
 const documentaryTerritories=new Map<string,Set<string>>();
 for(const u of data.units){const review=reviews.get(u.id);if(u.act_type==='award'&&u.status!=='rejected'&&!excluded(u)&&review?.status!=='excluded'&&!(review?.effective_at&&review.effective_at>cutoff)&&u.territory){
  const key=agreementIdentity(u),territories=documentaryTerritories.get(key)??new Set<string>();territories.add(u.territory);documentaryTerritories.set(key,territories);
 }}
 const chains=new Map(data.units.map(u=>[u.id,chain(u.id)]));
 // Topological order is independent of UUIDs or publication dates.
 const ordered=[...data.units].sort((a,b)=>chains.get(a.id)!.path.length-chains.get(b.id)!.path.length||
  (reviews.get(a.id)?.effective_at??'').localeCompare(reviews.get(b.id)?.effective_at??'')||a.id.localeCompare(b.id));
 for(const u of ordered){
  if(u.status==='rejected')continue;
  const review=reviews.get(u.id),c=chains.get(u.id)!;const issues:string[]=[];
  const isExcluded=excluded(u)||review?.status==='excluded';
  if(review?.effective_at&&review.effective_at>cutoff)continue;
  const period=review?.period_start&&review?.period_end?`${review.period_start}/${review.period_end}`:'Període pendent';
  const m:EvolutionMovement={unitId:u.id,recordId:u.source_record_id,rootId:c.root,provider:name(u),operation:review?.operation??'pending',period,
   territory:u.territory,supplementalGeography:u.supplemental_geography,amountCents:review?.amount_cents??null,amountKind:review?.amount_kind??'unknown',status:isExcluded?'excluded':'pending',issues,effectiveAt:review?.effective_at??null};
  movements.push(m);if(isExcluded){issues.push('Exclòs de la foto des de 2024; no suma');continue;}
  if(c.issue)issues.push(c.issue);
  if(!review||review.status!=='approved')issues.push('Interpretació econòmica pendent de revisió');
  if(u.status!=='approved')issues.push('Línia pendent de validació');
  if(u.line_award_state==='stale')issues.push('La revisió individual de l’adjudicació ha quedat obsoleta');
  if(review&&review.source_fingerprint!==u.source_fingerprint)issues.push('La font ha canviat des de la revisió');
  const publication=publications.get(u.source_record_id);
  if(review&&publication?.job_id!==review.expected_job_id)issues.push('L’anàlisi vigent no coincideix amb la revisada');
  if(review&&!['approved','corrected'].includes(publication?.job_status??'')&&!(u.line_award_state==='current'&&publication?.job_status==='needs_review'))issues.push('L’anàlisi vigent està pendent de validació humana');
  if(!review||!iso(review.period_start)||!iso(review.period_end)||review.period_end<review.period_start||review.period_start<'2024-01-01')issues.push('Període des de 2024 no acreditat');
  if(!review||!iso(review.effective_at))issues.push('Data d’efectes no acreditada');
  if(!review?.funder?.trim())issues.push('Finançador no acreditat');
  if(!u.storage_sha256||!u.storage_path||!u.page||!u.evidence_quote)issues.push('Font de la línia incompleta');
  if(!u.service_code)issues.push('Servei pendent de validació');
  if(!u.territory)issues.push('Territori pendent de validació');
  const geographyIssue=territoryStates.get(u.id)?.issue;if(geographyIssue)issues.push(geographyIssue);
  // Geography cannot silently split duplicate publications of one source row
  // into different economic scopes, nor create a territorial move in a chain.
  if(u.act_type==='award'&&(documentaryTerritories.get(agreementIdentity(u))?.size??0)>1)
   issues.push('Territoris incompatibles entre publicacions de la mateixa línia documental');
  for(const ancestorId of c.path.slice(1)){const ancestor=byId.get(ancestorId);
   if(ancestor?.territory&&u.territory&&ancestor.territory!==u.territory&&(territoryStates.get(u.id)?.applied||territoryStates.get(ancestorId)?.applied))
    issues.push('La ubicació complementària no coincideix amb el territori de la cadena revisada');
  }
  for(const ancestorId of c.path.slice(1)){
   const ancestor=movements.find(row=>row.unitId===ancestorId);
   if(!ancestor||ancestor.status!=='reviewed')issues.push('Hi ha un acte anterior pendent');
   const ar=reviews.get(ancestorId);
   if(review?.operation!=='correction'&&review?.effective_at&&ar?.effective_at&&ar.effective_at>review.effective_at)issues.push('Ordre de dates d’efectes contradictori');
  }
  if(review){
   if(review.annualities?.length){
    const periods=review.annualities;
    if(!['award','renewal'].includes(review.operation)||periods.some(p=>!iso(p.start)||!iso(p.end)||p.start<'2024-01-01'||p.end<p.start||!Number.isSafeInteger(p.amountCents)||p.amountCents<0)||!Number.isSafeInteger(review.amount_cents)||periods.reduce((s,p)=>s+BigInt(p.amountCents),BigInt(0))!==BigInt(review.amount_cents!)||periods.some((p,i)=>periods.some((q,j)=>i!==j&&p.start<=q.end&&p.end>=q.start))||periods.some(p=>p.start<review.period_start!||p.end>review.period_end!))issues.push('Anualitats invàlides, solapades o no conciliades amb el total');
   }
   if(review.operation!=='nonfinancial'&&(review.amount_cents===null||!Number.isSafeInteger(review.amount_cents)||review.amount_kind==='unknown'))issues.push('Import del moviment pendent de contrastar o no vàlid');
   if(review.operation==='award'&&u.act_type!=='award')issues.push('Un canvi no pot duplicar la base');
   if(u.act_type==='award'&&review.operation!=='award')issues.push('La base requereix una adjudicació');
   if(u.act_type==='cession'&&review.operation!=='nonfinancial')issues.push('La cessió no genera finançament');
   if(review.operation==='renewal'&&u.act_type!=='renewal')issues.push('Acte incompatible amb una pròrroga');
   if(review.operation==='nonfinancial'&&review.amount_cents!==null)issues.push('Un acte sense efecte econòmic no té import sumable');
  }
  if(issues.length||!c.root||!review){if(c.root)issues.forEach(issue=>block(c.root!,issue));continue;}
  const root=byId.get(c.root)!;
  // All units sharing the same archived source line share one agreement key.
  const canonical=agreementIdentity(root);
  const base:ConcertFinancialLine={id:u.id,agreementKey:canonical,transactionKey:canonical,serviceCode:u.service_code!,period,territory:u.territory!,funder:review.funder!,
   documentHash:u.document_identity??u.storage_sha256!,lineReference:u.unit_key.startsWith('official-annex:')?u.unit_key.split(':').slice(2).join(':'):`${u.page}:${u.evidence_quote}`,
   effectiveAt:review.effective_at!,sequence:accepted.length,operation:review.operation==='correction'?'replacement':review.operation,
   amountCents:review.amount_cents,amountKind:review.amount_kind,status:'approved'};
  if(['replacement','delta'].includes(review.operation)&&data.reviews.some(other=>{
   const otherUnit=byId.get(other.unit_id);
   return !!otherUnit&&otherUnit.status!=='rejected'&&!excluded(otherUnit)&&other.unit_id!==u.id&&other.status==='approved'&&['replacement','delta'].includes(other.operation)&&(review.operation==='replacement'||other.operation==='replacement')&&other.effective_at===review.effective_at&&!!other.period_start&&!!other.period_end&&!!review.period_start&&!!review.period_end&&other.period_start<=review.period_end&&other.period_end>=review.period_start&&chains.get(other.unit_id)?.root===c.root&&!c.path.includes(other.unit_id)&&!chains.get(other.unit_id)?.path.includes(u.id);
  })){issues.push('Efectes econòmics simultanis sense ordre acreditat');block(c.root,issues[0]);continue;}
  if(review.operation==='delta'){
   const periods=[...new Set(accepted.filter(a=>a.agreementKey===canonical&&a.serviceCode===base.serviceCode&&a.territory===base.territory&&a.funder===base.funder&&['award','renewal'].includes(a.operation)&&a.period.split('/')[0]<=review.period_start!&&a.period.split('/')[1]>=review.period_end!).map(a=>a.period))];
   if(periods.length===1)base.period=periods[0];
   else {issues.push('La modificació no correspon a un únic període de la base');block(c.root,issues[0]);continue;}
  }
  if(review.operation==='correction'){
   const target=accepted.find(line=>(line.id===review.corrects_unit_id||line.id.startsWith(`${review.corrects_unit_id}:annuality:`))&&line.period===period);
   if(!target||!c.path.slice(1).includes(review.corrects_unit_id!)||target.period!==period||target.serviceCode!==base.serviceCode||target.territory!==base.territory||target.funder!==base.funder||target.operation==='nonfinancial'){
    issues.push('La rectificació no identifica un acte econòmic anterior del mateix àmbit');block(c.root,issues[0]);continue;
   }
   // A correction restates the target act, then later deltas are replayed.
   if(data.reviews.some(other=>{
    const otherUnit=byId.get(other.unit_id);
    return !!otherUnit&&otherUnit.status!=='rejected'&&!excluded(otherUnit)&&other.unit_id!==review.unit_id&&other.status==='approved'&&other.operation==='correction'&&other.corrects_unit_id===review.corrects_unit_id&&other.effective_at&&other.effective_at<=cutoff&&!c.path.includes(other.unit_id)&&!chains.get(other.unit_id)?.path.includes(u.id);
   })){issues.push('Rectificacions concurrents sense ordre acreditat');block(c.root,issues[0]);continue;}
   target.amountCents=review.amount_cents;target.amountKind=review.amount_kind;
  }else{
   if(['award','renewal'].includes(base.operation)&&accepted.some(a=>a.agreementKey===canonical&&a.serviceCode===base.serviceCode&&a.territory===base.territory&&a.funder===base.funder&&['award','renewal'].includes(a.operation)&&!(a.documentHash===base.documentHash&&a.lineReference===base.lineReference)&&a.period!==period&&a.period.split('/')[0]<=review.period_end!&&a.period.split('/')[1]>=review.period_start!)){issues.push('Períodes de finançament solapats');block(c.root,issues[0]);continue;}
   const before=projectConcertBalances(accepted).find(b=>b.agreementKey===canonical&&b.period===base.period&&b.serviceCode===base.serviceCode&&b.territory===base.territory&&b.funder===base.funder);
   m.beforeCents=before?.amountCents??null;
   const annualities=review.annualities??[];
   if(annualities.length){for(const [index,a] of annualities.entries())accepted.push({...base,id:`${base.id}:annuality:${index}`,period:`${a.start}/${a.end}`,amountCents:a.amountCents});}
   else accepted.push(base);
  }
  const after=projectConcertBalances(accepted).find(b=>b.agreementKey===canonical&&b.period===base.period&&b.serviceCode===base.serviceCode&&b.territory===base.territory&&b.funder===base.funder);
  m.afterCents=after?.amountCents??null;m.status='reviewed';
  if(after?.issues.length){issues.push(...after.issues);issues.forEach(issue=>block(c.root!,issue));}
 }
 // A candidate later act makes all its possible mothers visibly incomplete.
 for(const link of data.links.filter(l=>l.status==='candidate')){
  const m=movements.find(row=>row.unitId===link.later_unit_id);
  if(m&&m.status==='pending'){
   const root=chains.get(link.earlier_unit_id)?.root;if(root)block(root,'Modificació candidata pendent de vincular i revisar');
  }
 }
 for(const missing of data.missingLines??[]){for(const u of data.units.filter(u=>u.source_record_id===missing.earlier_record_id||u.source_record_id===missing.later_record_id)){const root=chains.get(u.id)?.root;if(root)block(root,'Hi ha una publicació relacionada sense línies contrastades o amb línies pendents de vincular');}}
 const individualBalances:EvolutionBalance[]=projectConcertBalances(accepted).map(b=>{
  const roots=data.units.filter(u=>u.act_type==='award'&&u.status!=='rejected'&&!excluded(u)&&agreementIdentity(u)===b.agreementKey);
  const root=roots[0];
  const rootIds=roots.map(u=>u.id);
  const issues=[...new Set([...b.issues,...rootIds.flatMap(id=>[...(affected.get(id)??[])])])];
  if(new Set(roots.map(u=>u.provider_nif)).size>1)issues.push('Titularitat incompatible entre línies duplicades del mateix document');
  const cessions=movements.filter(m=>m.rootId!==null&&rootIds.includes(m.rootId)&&m.status==='reviewed'&&byId.get(m.unitId)?.act_type==='cession'&&m.effectiveAt&&m.effectiveAt<=cutoff);
  const current=cessions.filter(m=>!cessions.some(other=>other.unitId!==m.unitId&&chains.get(other.unitId)?.path.includes(m.unitId)));
  if(current.length>1)issues.push('Cessions concurrents sense successor únic acreditat');
  const holder=current.length===1?byId.get(current[0].unitId)!:root;
  if(!holder.provider_nif)issues.push('NIF de l’entitat vigent no acreditat');
  return {rootId:root.id,rootIds,providerNif:holder.provider_nif,provider:name(holder),service:b.serviceCode,territory:b.territory,period:b.period,funder:b.funder,
   amountCents:issues.length?null:b.amountCents,maximum:b.maximum,issues};
 });
 const grouped=new Map<string,EvolutionBalance>();
 for(const balance of individualBalances){
  const key=JSON.stringify([balance.providerNif??balance.rootId,balance.service,balance.territory,consolidatedPeriodKey(balance.period),balance.funder]);
  const prior=grouped.get(key);
  if(!prior){grouped.set(key,{...balance,rootIds:[...balance.rootIds],issues:[...balance.issues]});continue;}
  if(balance.period<prior.period)prior.period=balance.period;
  prior.rootIds.push(...balance.rootIds);prior.maximum ||= balance.maximum;
  prior.issues=[...new Set([...prior.issues,...balance.issues])];
  prior.amountCents=prior.amountCents===null||balance.amountCents===null?null:prior.amountCents+balance.amountCents;
  if(prior.amountCents!==null&&!Number.isSafeInteger(prior.amountCents)){prior.amountCents=null;prior.issues.push('Total fora de la precisió segura');}
 }
 const balances=[...grouped.values()];
 // A reviewed change is a valid individual movement, but a second unresolved
 // line in the same document may affect the same consolidated scope. Do not
 // infer a transfer or pair lines merely from opposite signs or equal amounts.
 const overlaps=(a:string,b:string)=>{
  const [aStart,aEnd,...aExtra]=a.split('/'),[bStart,bEnd,...bExtra]=b.split('/');
  if(aExtra.length||bExtra.length||!iso(aStart)||!iso(aEnd)||!iso(bStart)||!iso(bEnd)||aEnd<aStart||bEnd<bStart)return true;
  return aStart<=bEnd&&bStart<=aEnd;
 };
 const changesByRoot=new Map<string,EvolutionMovement[]>(),pendingByDocument=new Map<string,EvolutionMovement[]>(),pendingWithoutDocument=new Map<string,EvolutionMovement[]>(),pendingByRecord=new Map<string,EvolutionMovement[]>();
 for(const movement of movements){
  if(movement.status==='reviewed'&&movement.rootId&&['delta','replacement','correction'].includes(movement.operation)){
   const changes=changesByRoot.get(movement.rootId)??[];changes.push(movement);changesByRoot.set(movement.rootId,changes);
  }
  if(movement.status==='pending'){
   const recordPending=pendingByRecord.get(movement.recordId)??[];recordPending.push(movement);pendingByRecord.set(movement.recordId,recordPending);
   const document=byId.get(movement.unitId)?.document_id;
   if(document){const key=JSON.stringify([movement.recordId,document]),pending=pendingByDocument.get(key)??[];pending.push(movement);pendingByDocument.set(key,pending);}
   else{const pending=pendingWithoutDocument.get(movement.recordId)??[];pending.push(movement);pendingWithoutDocument.set(movement.recordId,pending);}
  }
 }
 for(const balance of balances){
  const changes=balance.rootIds.flatMap(root=>changesByRoot.get(root)??[]);
  const unresolved=changes.some(change=>{
   const applied=byId.get(change.unitId);if(!applied)return false;
   // The unresolved sibling can affect a different scope from the reviewed
   // endpoint. Test its own evidenced scope against every balance of the root.
   const candidates=applied.document_id?[...(pendingByDocument.get(JSON.stringify([change.recordId,applied.document_id]))??[]),...(pendingWithoutDocument.get(change.recordId)??[])]:pendingByRecord.get(change.recordId)??[];
   return candidates.some(other=>{
    if(other.unitId===change.unitId)return false;
    const candidate=byId.get(other.unitId),review=reviews.get(other.unitId),publication=publications.get(other.recordId);
    if(!candidate)return false;
    const reviewedPeriod=candidate.status==='approved'&&candidate.line_award_state!=='stale'&&review?.status==='approved'&&review.source_fingerprint===candidate.source_fingerprint
     &&review.expected_job_id===publication?.job_id&&['approved','corrected'].includes(publication?.job_status??'');
    if(reviewedPeriod&&((review.funder?.trim()&&review.funder!==balance.funder)||(candidate.territory&&candidate.territory!==balance.territory)))return false;
    return !reviewedPeriod||overlaps(other.period,balance.period);
   });
  });
  if(unresolved){
   balance.amountCents=null;
   balance.issues.push('Hi ha una altra línia pendent del mateix document o de document no identificat del mateix expedient que pot afectar aquest saldo consolidat; cal revisar-la sense inferir-ne la relació.');
  }
 }
 return {version:ECONOMIC_RULES_VERSION,cutoff,horizon:2024,movements,individualBalances,balances,pending:movements.filter(m=>m.status==='pending').length,
  excluded:movements.filter(m=>m.status==='excluded').length,missingLines:data.missingLines??[]};
}

/** Documented proportional allocation; largest remainder keeps the exact cents. */
export function allocateByWeights(totalCents:number,weights:number[]):number[]{
 if(!Number.isSafeInteger(totalCents)||totalCents<0||!weights.length||weights.some(w=>!Number.isSafeInteger(w)||w<0))throw Error('Repartiment no vàlid');
 const sum=weights.reduce((n,w)=>n+BigInt(w),BigInt(0));if(sum===BigInt(0))throw Error('Falten pesos acreditats');
 const parts=weights.map((w,index)=>({index,amount:BigInt(totalCents)*BigInt(w)/sum,remainder:BigInt(totalCents)*BigInt(w)%sum}));
 let remaining=BigInt(totalCents)-parts.reduce((n,p)=>n+p.amount,BigInt(0));
 for(const p of [...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(remaining===BigInt(0))break;p.amount++;remaining--;}
 return parts.map(p=>Number(p.amount));
}

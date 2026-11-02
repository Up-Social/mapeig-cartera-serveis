import React from 'react';
export type StoredConcertGeography={municipality:string|null;county:string|null;province:string|null;page:number;evidence:{reference?:{sourceUrl?:string}|null}};
export type SupplementalConcertGeography={review_valid?:boolean;decision?:string|null;review_id?:string|null;reviewer?:string|null;rationale?:string|null;reviewed_at?:string|null;conflict?:boolean;municipality:string;county:string|null;province:string|null;source_url:string;source_quote:string;source_captured_at:string;source_sha256:string;reference:{sourceUrl?:string}|null};
export function ConcertGeography({geography,municipality,supplemental}:{geography?:StoredConcertGeography|null;municipality:string|null;supplemental?:SupplementalConcertGeography|null}){
 const confirmed=supplemental?.decision==='confirmed'&&supplemental.review_valid===true&&!!supplemental.review_id&&supplemental.conflict===false;
 const effective=geography??(confirmed?supplemental:null);
 return (<div className="mt-3 rounded-lg border bg-muted/10 p-3 text-xs" aria-label="Localització del servei">
       <dl className="grid gap-2 sm:grid-cols-3">
        <div><dt className="font-semibold">Municipi</dt><dd>{effective?.municipality??municipality??'Pendent: no identificat amb evidència suficient en aquesta línia.'}</dd></div>
        <div><dt className="font-semibold">Comarca</dt><dd>{effective?.county??'Pendent: no s’ha pogut contrastar la comarca del municipi.'}</dd></div>
        <div><dt className="font-semibold">Província</dt><dd>{effective?.province??'Pendent: no s’ha pogut contrastar la província del municipi.'}</dd></div>
       </dl>
       {geography&&<p className="mt-2 text-muted-foreground">Municipi indicat a l’annex, pàgina {geography.page}. {geography.evidence.reference?<>Comarca i província segons la <a className="underline" href="https://www.idescat.cat/codis/?id=50&lang=en&n=84" target="_blank" rel="noopener noreferrer">correspondència territorial d’Idescat</a>.</>:<>Comarca i província pendents: no s’ha trobat una correspondència territorial inequívoca.</>}</p>}
       {supplemental&&<div className="mt-3 rounded border p-2"><p className="font-semibold">{confirmed?'Ubicació de font complementària · confirmada per revisió humana':supplemental.decision==='rejected'?'Proposta d’ubicació de font complementària · rebutjada':supplemental.decision==='revoked'?'Proposta d’ubicació de font complementària · confirmació revocada':'Proposta d’ubicació de font complementària · pendent de revisió'}</p>
        <p>{[supplemental.municipality,supplemental.county,supplemental.province].filter(Boolean).join(' · ')}</p>
        <blockquote className="mt-1">«{supplemental.source_quote}»</blockquote>
        <p className="mt-1">{confirmed?`Revisió declarada per ${supplemental.reviewer??"revisor no indicat"}: ${supplemental.rationale??""}`:"Transcripció pendent de contrast amb la còpia capturada. Cal confirmar que la font i el període corresponen a aquesta línia."} {confirmed?'La ubicació revisada pot completar el territori de la foto econòmica; les altres validacions i el finançador continuen independents.':'No modifica el territori econòmic ni confirma finançament.'}</p>
        {supplemental.conflict&&<p role="alert">Conflicte amb la geografia documental vigent: proposta no aplicable.</p>}
        <a className="underline" href={supplemental.source_url.startsWith('https://')?supplemental.source_url:undefined} target="_blank" rel="noopener noreferrer">Consultar la font complementària</a>
        {supplemental.reference&&<> · Comarca i província segons <a className="underline" href="https://www.idescat.cat/codis/?id=50&lang=en&n=84" target="_blank" rel="noopener noreferrer">Idescat</a></>}
       </div>}
      </div>);
}

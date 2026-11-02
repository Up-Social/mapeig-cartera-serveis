import React from 'react';
export type StoredConcertGeography={municipality:string|null;county:string|null;province:string|null;page:number;evidence:{reference?:{sourceUrl?:string}|null}};
export function ConcertGeography({geography,municipality}:{geography?:StoredConcertGeography|null;municipality:string|null}){
 return (<div className="mt-3 rounded-lg border bg-muted/10 p-3 text-xs" aria-label="Localització del servei">
       <dl className="grid gap-2 sm:grid-cols-3">
        <div><dt className="font-semibold">Municipi</dt><dd>{geography?.municipality??municipality??'Pendent: no identificat amb evidència suficient en aquesta línia.'}</dd></div>
        <div><dt className="font-semibold">Comarca</dt><dd>{geography?.county??'Pendent: no s’ha pogut contrastar la comarca del municipi.'}</dd></div>
        <div><dt className="font-semibold">Província</dt><dd>{geography?.province??'Pendent: no s’ha pogut contrastar la província del municipi.'}</dd></div>
       </dl>
       {geography&&<p className="mt-2 text-muted-foreground">Municipi indicat a l’annex, pàgina {geography.page}. {geography.evidence.reference?<>Comarca i província segons la <a className="underline" href="https://www.idescat.cat/codis/?id=50&lang=en&n=84" target="_blank" rel="noopener noreferrer">correspondència territorial d’Idescat</a>.</>:<>Comarca i província pendents: no s’ha trobat una correspondència territorial inequívoca.</>}</p>}
      </div>);
}

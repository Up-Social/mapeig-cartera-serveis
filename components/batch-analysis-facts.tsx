import type {BatchJob} from '@/lib/batch-types';

export function BatchAnalysisFacts({analysis}:{analysis:BatchJob['analysis']}){
 if(!analysis)return null;
 if(analysis.reliability_status==='invalidated')return <p role="status" className="text-sm text-muted-foreground">El resultat no és fiable i no acredita el servei ni els destinataris. Consulta el registre per revisar-ne el resultat històric.</p>;
 const population=analysis.target_population?.trim();
 const concertCatalog=['concert-program-lines-v2','concert-reconciled-annex-v1'].includes(analysis.rules_version??'');
 return <dl className="grid gap-3 text-sm sm:grid-cols-3">
  <div><dt className="font-semibold">Servei identificat</dt><dd className="mt-1 text-muted-foreground">{analysis.service_description?.trim()||'No prou acreditat'}</dd></div>
  <div><dt className="font-semibold">{concertCatalog?'Text de població de l’anàlisi':'Destinataris proposats per l’anàlisi · pendent de contrastar'}</dt><dd className="mt-1 text-muted-foreground">
   {population?<><p>{population}</p><p className="mt-1 text-xs">{concertCatalog?'En aquesta regla, el text pot derivar de la descripció del catàleg. No acredita la població de cada línia; cal contrastar-la amb la font.':'Aquesta descripció no acredita per si sola les característiques de les persones destinatàries del cas. Contrasta-la amb els fragments i les limitacions de la proposta.'}</p></>:'No identificats a l’anàlisi · pendents de contrast'}
  </dd></div>
  <div><dt className="font-semibold">Evidència disponible</dt><dd className="mt-1 text-muted-foreground">{analysis.evidence.length?`${analysis.evidence.length} fragment(s)`:'Cap fragment acreditat'}</dd></div>
 </dl>;
}

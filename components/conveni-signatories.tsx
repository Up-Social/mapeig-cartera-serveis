import type {normalizeConveni} from '@/lib/convenis/contract';

/** Source fields are indications to review, not a verified list of parties. */
export function ConveniSignatories({source}:{source:ReturnType<typeof normalizeConveni>}){
 return <section className="space-y-2 rounded border p-3 text-sm" aria-labelledby="conveni-signatories-heading">
  <h3 id="conveni-signatories-heading" className="font-semibold">Organismes signants segons l’Excel</h3>
  <p className="break-words">Generalitat i ens locals: {source.publicSignatories.length?source.publicSignatories.join('; '):'no informats a l’Excel · pendents de contrast'}.</p>
  {source.signatoriesState==='listed'
   ? <><p className="break-words">Altres organismes indicats: {source.signatories.join('; ')}.</p><p>La llista de l’Excel no acredita que hi constin tots els signants ni la seva naturalesa. Cal contrastar el conveni i els annexos abans de classificar-lo.</p></>
   : <p className="status-warning rounded p-2">Altres organismes signants: dada no informada a l’Excel · pendent de contrast. El camp buit no acredita que no hi hagi altres signants.</p>}
  <p>Un signant no és necessàriament el receptor de l’aportació. Les parts i els seus rols s’han de verificar amb les fonts.</p>
 </section>;
}

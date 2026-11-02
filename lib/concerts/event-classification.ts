/** Shared classification for the existing e-Tauler discovery and historical scans. */
export type ConcertEventType='nova_provisio_o_ampliacio'|'prorroga'|'modificacio'|'autoritzacio_despesa'|'resolucio_anticipada_o_baixa'|'cessio'|'esmena'|'altres';
export function classifyConcertEvent(title:string,description:string):{eventType:ConcertEventType;countsAsNewFinancing:boolean} {
 const currentTitle=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 // A correction of a renewal or modification is still an amendment. Limit
 // this priority to the current act named at the start of the title; a later
 // mention of a correction in a renewal does not decide the act's nature.
 if(/^(?:resolucio\s+(?:d['’]|de\s+))?(?:esmena|rectificacio|correccio)\b/.test(currentTitle))return {eventType:'esmena',countsAsNewFinancing:false};
 const text=`${title} ${description}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/resolucio anticipada|extincio|baixa|retirada|finalitzacio/.test(text))return {eventType:'resolucio_anticipada_o_baixa',countsAsNewFinancing:false};
 if(/prorroga/.test(text))return {eventType:'prorroga',countsAsNewFinancing:false};
 if(/modificacio|modifica /.test(text))return {eventType:'modificacio',countsAsNewFinancing:false};
 if(/esmena|correccio|rectificacio/.test(text))return {eventType:'esmena',countsAsNewFinancing:false};
 if(/cessio/.test(text))return {eventType:'cessio',countsAsNewFinancing:false};
 if(/autoritzacio de la despesa/.test(text))return {eventType:'autoritzacio_despesa',countsAsNewFinancing:false};
 if(/provisio de places|provisio de serveis|provisio directa|convocatoria.*provisio|assignacio de places/.test(text))return {eventType:'nova_provisio_o_ampliacio',countsAsNewFinancing:true};
 return {eventType:'altres',countsAsNewFinancing:false};
}

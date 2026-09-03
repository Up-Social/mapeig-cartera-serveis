# Contracte del pipeline de matching

El matching s'executa de manera controlada sobre els registres preparats d'un lot. Abans de processar-lo, `npm run matching:ready` comprova cinc precondicions:

1. `OPENAI_API_KEY` configurada només al servidor.
2. `OPENAI_MATCHING_MODEL` definit explícitament.
3. Documents extrets i fragments d'evidència disponibles.
4. Catàleg objectiu autoritzat.
5. Treballs persistents en cua.

## Catàleg objectiu

El Master està importat, però no queda autoritzat per al matching pel simple fet d'existir. Les opcions previstes són:

```env
MATCHING_CATALOG_SOURCE=official
```

o, només després d'una autorització explícita de l'usuari:

```env
MATCHING_CATALOG_SOURCE=master
ALLOW_MASTER_MATCHING=true
```

## Persistència

- `matching_candidates`: fins a tres candidats ordenats, amb puntuació, justificació, motor i versió. La base admet ranks fins a 10 per compatibilitat històrica, però el contracte actual en genera com a màxim 3.
- `matching_candidate_evidence`: fragments exactes que sustenten cada candidat.
- `record_enrichments`: camps estructurats extrets dels documents oficials (entitat, NIF, mecanisme, data, import, organisme i col·lectiu), resum i confiança.
- `record_enrichment_evidence`: fragments oficials exactes que sustenten l'enriquiment.
- `matching_evaluations`: veredicte humà separat del resultado automático.

No es pot copiar una proposta a `source_records.cartera_code` com a resultat final sense passar per revisió humana.

Les fórmules d'Excel s'exclouen tant del prompt com de la interfície. Les dades originals només aporten context; els camps contrastats es poden omplir exclusivament des dels fragments dels documents externs descarregats. Si un document no acredita un camp, el model ha de retornar `null` en lloc d'inventar-lo.

La preparació documental, l'enriquiment oficial i el matching són etapes independents. `enrichment:run` no rep el catàleg ni pot proposar serveis. Quan un registre ja té `record_enrichments`, `matching:run` reutilitza aquest resultat i demana exclusivament candidats, evitant repetir l'extracció i el seu cost.

## Provisions normalitzades i exportació

`master_services` només conté el catàleg de serveis de `Tabla (resumen)`. Els imports i les files de provisió no es llegeixen de les fórmules del Master.

Quan un matching hagi estat revisat, el resultat normalitzat es desa a `service_provisions`, amb el contracte de camps de `Detalle_Provisiones`: identificador i font, enllaços, entitat i NIF, mecanisme, data, import, òrgan contractant, població objectiu i codi de Cartera validat. L'exportació hi afegeix el nom del servei. En aprovar, els camps contrastats de `record_enrichments` tenen prioritat sobre els camps originals de l'Excel.

`service_provisions` és la font de consulta del catàleg i de les exportacions actuals:

- cada lot amb almenys una provisió vigent pot descarregar un llibre independent amb `Detalle_Provisiones`;
- la pantalla **Aprovats** pot exportar entre 1 i 5.000 provisions seleccionades;
- `/api/exports/master`, quan existeix `MASTER_EXCEL_PATH`, genera una còpia del Master amb totes les provisions vigents i força el recàlcul de les fórmules en obrir el llibre.

Cap exportació modifica el Master original.

## Revisió humana

La pantalla de detall del registre mostra els candidats, la puntuació, la justificació i els fragments d'evidència. La persona revisora pot:

- aprovar el primer candidat;
- seleccionar una alternativa, que queda registrada com a correcció;
- rebutjar el matching;
- marcar l'evidència com a insuficient.

El rebuig i l'evidència insuficient exigeixen un motiu. Aquests casos, juntament amb els errors de preparació, contrast o matching, apareixen a **Incidències** amb el detall disponible i una acció per revisar la decisió o reintentar la fase.

Els errors de registres individuals i de lots propaguen `processing_status=error` a la fila d'origen. La consulta d'incidències també contrasta els `pipeline_jobs` fallits i les decisions negatives per recuperar el cas encara que una interrupció hagués deixat el camp general desactualitzat.

Només l'aprovació o correcció crea una fila a `service_provisions`. La decisió queda auditada a `review_decisions` i `matching_evaluations`. Una rectificació demana confirmació, conserva l'historial i actualitza o retira la provisió vigent.

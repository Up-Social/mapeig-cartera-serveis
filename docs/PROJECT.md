# Mapeig del finançament de la Cartera de Serveis Socials

## Estat del document

Descripció funcional del producte implementat. El codi i les migracions del repositori són la font de veritat tècnica. Els recomptes de dades poden canviar amb noves importacions; `DATA_INTEGRITY_AUDIT.md` conserva una fotografia datada.

## Objectiu

El PoC relaciona provisions de finançament públic amb els serveis de la Cartera de Serveis Socials de Catalunya. Per cada cas ha de conservar el mecanisme, la font, l'identificador original, les dades observades, els documents justificatius, el servei proposat, la confiança, les alternatives i la decisió humana.

Les quatre tipologies són contractació pública, conveni, subvenció i concert social o gestió delegada. No es fusionen perquè tenen fonts i semàntiques diferents.

## Principis no negociables

- La fila original és immutable i manté fitxer, full, número de fila i payload.
- Les dades originals aporten context, però no substitueixen el contrast documental.
- L'enriquiment només pot afirmar camps sustentats per fragments oficials.
- El matching és una proposta, mai una decisió final.
- Confiança, evidència i revisió humana es desen per separat.
- Una provisió s'associa per defecte a un únic servei.
- Els múltiples rols o entitats no multipliquen imports.
- Cap exportació modifica el Master original.

## Fonts actuals

### Consolidats d'ingesta

S'importen contractació pública PSCP, convenis del Registre de Convenis i subvencions RAISC, separades entre Generalitat i administracions locals. Aquests llibres permeten provar la ingesta i la interfície. La versió definitiva ha de recuperar les dades de fonts públiques i conservar la URL i la data de captura.

### Concert social i gestió delegada

El connector d'e-Tauler consulta cerques paginades, torna a comprovar l'expressió literal i limita el període a 2024-2026. La importació exigeix confirmar el recompte descobert i és idempotent. Els actes es classifiquen de manera preliminar segons l'efecte; una pròrroga, una baixa o una resolució anticipada no es tracten automàticament com a nova provisió.

### RESES

RESES enriqueix entitats, establiments, tipologies, territori i capacitat. És evidència auxiliar: una coincidència registral no demostra que una provisió concreta financi un servei.

### Catàleg Master

El Master autoritzat s'importa a `master_services`, separat de `source_records`. Conté 142 files, de les quals 140 tenen estat `Dentro` i són les úniques elegibles per al matching actual.

La seva importació no autoritza a utilitzar-lo per generar, entrenar, ajustar o validar silenciosament resultats. L'ús per al matching requereix configuració i autorització explícites. Les dues files il·lustratives fora de cartera no entren al prompt.

## Producte implementat

La navegació actual conté:

En escriptori es presenta com una barra lateral fixa; en pantalles petites es converteix en un panell lateral. Els accessos de Revisió, Incidències i Aprovats incorporen els seus recomptes vigents.

1. **Registres**: consulta, filtres, detall, documents i procés individual.
2. **Lots**: selecció automàtica d'1 a 50 casos, progrés i incidències.
3. **Revisió**: decisió humana sobre candidats i evidència.
4. **Incidències**: decisions negatives, evidència insuficient i errors del procés, amb motiu, detall i acció de resolució.
5. **Aprovats**: provisions vigents i exportació seleccionada.
6. **Catàleg**: serveis, provisions i relacions amb entitats.
7. **Entitats**: normalització, mencions, RESES i relacions.
8. **Procés**: explicació metodològica, estat i límits.

La web té un accés restringit per contrasenya compartida. Si `APP_ACCESS_PASSWORD` no està configurada, falla de manera tancada.

## Flux operatiu

1. Importar o descobrir registres amb procedència completa.
2. Evitar que una identitat ja processada entri en un altre lot.
3. Preparar documents i fragments auditables.
4. Extreure camps contrastats des de fonts oficials.
5. Proposar fins a tres serveis amb puntuació, justificació i evidència.
6. Aprovar o corregir; si es rebutja o es declara evidència insuficient, registrar-ne obligatòriament el motiu.
7. Crear `service_provisions` només després d'una decisió positiva.
8. Gestionar les decisions negatives i els errors tècnics des d'**Incidències**.
9. Exportar les provisions vigents per lot, per selecció o dins d'una còpia del Master.

## Persistència

Supabase és la font de veritat. Les capes principals són:

- originals: `import_runs`, `source_records`;
- documents: `source_documents`, `evidence_chunks`;
- execució: `pipeline_runs`, `pipeline_jobs`, `worker_tasks`;
- contrast: `record_enrichments`, `record_enrichment_evidence`;
- proposta: `matching_candidates`, `matching_candidate_evidence`;
- revisió: `review_decisions`, `matching_evaluations`;
- resultat: `service_provisions`;
- exportació: `excel_exports`, `excel_export_items`;
- entitats i RESES: `entities`, `entity_mentions`, `source_record_entities`, `reses_services` i relacions auxiliars.

Els canvis d'esquema es fan exclusivament amb migracions timestampades.

## Execució local i desplegada

En desenvolupament, Next.js i Supabase s'executen localment i els processos poden iniciar-se immediatament des de la web. En producció, Vercel atén la interfície i les operacions curtes; les operacions llargues creen `worker_tasks` i les executa un worker TypeScript extern contra Supabase remot.

El worker processa una tasca cada vegada, manté heartbeat, recupera tasques interrompudes i reintenta el procés complet fins a tres vegades.

## Estat i límits actuals

Estan implementats la ingesta dels consolidats, el connector d'e-Tauler, la preparació HTML/PDF, l'enriquiment, el matching amb IA, la revisió, les provisions, les exportacions, les entitats, la sincronització RESES i l'auditoria d'integritat.

Continuen fora o incomplets:

- connector BDNS;
- reconstrucció del catàleg des de la font pública oficial;
- reducció prèvia de candidats amb regles, CPV, RESES i similitud semàntica;
- OCR per als documents sense text;
- tauler de qualitat agregada amb precisió, cobertura i conciliació jeràrquica;
- desagregació econòmica completa dels annexos de concert social.

No s'ha de processar automàticament tot l'univers fins que existeixi una mostra humana suficient i s'hagin mesurat la precisió exacta i jeràrquica, la cobertura, la taxa de revisió i la traçabilitat de l'evidència.

## Criteri de finalització del PoC

El PoC estarà complet quan pugui reproduir-se des de fonts públiques, conciliï imports i jerarquia, acrediti totes les assignacions, mesuri la qualitat sobre una mostra humana i generi els lliurables sense dependre de les provisions manuals del Master.

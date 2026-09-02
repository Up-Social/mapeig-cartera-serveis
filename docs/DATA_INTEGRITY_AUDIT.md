# Auditoria d'integritat i coherència de dades

## Abast i metodologia

Auditoria no destructiva executada el **2 de setembre de 2026** sobre l'esquema `public` de Supabase remot. S'han recorregut totes les files mitjançant paginació de 1.000 registres; no s'ha utilitzat cap mostra ni s'han modificat dades. La comprovació es pot repetir amb:

```bash
npm run audit:data
```

L'script contrasta les dades amb les claus, restriccions i funcions del dump remot, les migracions versionades i els fluxos TypeScript. L'informe mostra només UUID tècnics i recomptes; no publica noms, NIF, textos documentals ni altres dades personals.

## Resum executiu

La integritat referencial és bona: no s'han detectat files òrfenes, evidències vinculades a un altre registre, codis de servei inexistents, provisions sense revisió positiva, recomptes de lot incorrectes ni exportacions incoherents. Els 23 jobs existents són terminals: 19 `needs_review` i 4 `approved`.

Hi ha dues incidències de dades que requereixen correcció, una fila històrica incompleta, una ambigüitat temporal i un conjunt de possibles duplicats que només requereix revisió, no eliminació:

1. **Alta — 8 candidats de 3 registres sense evidència enllaçada.**
2. **Mitjana — 27.732 registres pendents marcats amb `evidence_status=error` sense error real.**
3. **Mitjana — 1 job històric aprovat conserva `preparation_status=pending`.**
4. **Mitjana — 13 lots `needs_review` tenen `completed_at`, amb semàntica ambigua.**
5. **Baixa — 865 files comparteixen identitat de deduplicació, agrupades en 351 clústers.**

No s'ha aplicat cap correcció de dades.

## Volum auditat

| Entitat | Files |
| --- | ---: |
| `source_records` | 28.124 |
| `source_documents` | 52.530 |
| `evidence_chunks` | 157 |
| `pipeline_runs` / `pipeline_jobs` | 20 / 23 |
| `worker_tasks` | 25 |
| `record_enrichments` / evidències | 22 / 31 |
| `matching_candidates` / evidències | 67 / 63 |
| `matching_evaluations` / `review_decisions` | 5 / 5 |
| `service_provisions` | 4 |
| `master_services` | 142, de les quals 140 són `Dentro` |
| `entities` / `entity_mentions` | 2.614 / 27.819 |
| `reses_services` / mapatges | 6.843 / 42 |
| `excel_exports` / elements | 6 / 10 |

## Fonts, transformacions i fonts de veritat

| Secció | Procedència | Transformació i relacions | Font de veritat |
| --- | --- | --- | --- |
| Registres | Excel consolidats de contractació, convenis i RAISC; connector e-Tauler per concerts | `import_runs` → `source_records`; la fila original queda a `source_payload`, amb fitxer/full/fila o URL del connector | `source_records.source_payload` i camps de procedència |
| Tipologia i duplicats | Dataset, títol, entitat, import i data administrativa | Trigger `set_source_record_classification` calcula `financing_type` i `deduplication_key` | `source_records.financing_type` i `deduplication_key` |
| Documents | URL detectades als payloads públics | `source_documents`; descàrrega, extracció, hash i fragmentació a `evidence_chunks` | Document i fragments persistits, no la fila Excel |
| Contrast | Fragments oficials | OpenAI estructura camps a `record_enrichments`; `record_enrichment_evidence` cita fragments | `record_enrichments` més les seves evidències; no sobreescriu l'original |
| Matching | Fragments, enriquiment i 140 serveis autoritzats del catàleg | `matching_candidates` i `matching_candidate_evidence` vinculats al job | Proposta automàtica; mai és decisió final |
| Revisió | Acció humana | Historial immutable a `review_decisions` i avaluació a `matching_evaluations` | Decisió humana més recent |
| Provisions | Decisió positiva i camps contrastats/originals | Upsert únic per registre a `service_provisions` | `service_provisions` per consulta i exportació |
| Entitats | RESES públic i mencions dels registres | NIF exacte o revisió; RESES només crea relacions auxiliars | `entities`; relacions confirmades i auxiliars continuen separades |
| Exportacions | Provisions vigents aprovades | `excel_exports` i `excel_export_items`; el fitxer original no es modifica | `service_provisions` en el moment de l'exportació |

`master_services` és una referència aïllada: conté 142 files, però el matching només consulta les 140 amb estat `Dentro`. Les altres dues no entren al prompt.

## Tipologies i coherència dels hitos

| Dataset | Tipologia obligatòria | Registres | Resultat |
| --- | --- | ---: | --- |
| `contractacions` | `contractacio` | 1.686 | 0 discrepàncies |
| `convenis` | `conveni` | 615 | 0 discrepàncies |
| `raisc_ccaa` | `subvencio` | 11.264 | 0 discrepàncies |
| `raisc_local` | `subvencio` | 14.254 | 0 discrepàncies |
| `concerts` | `concert` | 305 | 0 discrepàncies |

No hi ha hitos sense fase, tipologia o dataset. Les combinacions actuals de `pipeline_runs.status/stage` són 16 `needs_review/review` i 4 `completed/completed`; no s'han observat combinacions desconegudes. Les combinacions de job són 19 `needs_review/ready`, 3 `approved/ready` i una fila històrica `approved/pending` descrita a A3.

## Estats i transicions implementades

### Registre

`pendent → preparant → preparat → processant → revisio → completat | rebutjat`

- `sense_evidencia` és terminal per `no_source` o `unsupported`.
- `error` pot originar-se en preparació, contrast o matching i admet reintent explícit.
- `evidence_status` i `enrichment_status` són fases independents del `processing_status` general.

### Job

`selected → preparing → ready → matching → needs_review → approved | corrected | rejected | insufficient_evidence`

`error` és terminal per intent, però l'orquestrador pot retornar-lo de manera segura a la fase corresponent. `preparation_status` recorre `pending → discovering → fetching → chunking → ready`, o acaba en `no_source`, `unsupported` o `error`.

### Lot

`queued → preparing → enriching → matching → needs_review → completed`

Les fases corresponents són `preparation`, `enrichment`, `matching`, `review` i `completed`. Els fluxos antics poden contenir `draft`, `ready`, `selection` o `confirmation`; es conserven per compatibilitat.

### Tasca persistent

`queued → running → completed | failed`. `process_run` té heartbeat, reintents i reprèn les fases ja completades.

### Revisió i provisió

La decisió pot ser `approved`, `corrected`, `rejected` o `insufficient_evidence`. Només les dues primeres creen o actualitzen `service_provisions`; la resta retiren la provisió vigent si existia.

## Incidències observades

### A1. Candidats sense evidència — alta

- **Quantitat:** 8 candidats, corresponents a 3 jobs i 3 registres.
- **Entitats tècniques afectades:** registres `96e697f4-4bef-4c1e-b94b-0c638354fcd6`, `d969f6ef-9c59-44e0-842f-741928be018f` i `542ef729-1f66-4cfd-83dd-7393b4154be0`.
- **Evidència:** els candidats tenen codi, nom, puntuació i justificació, però no tenen cap fila a `matching_candidate_evidence`. Cada registre disposa d'un únic fragment vàlid.
- **Causa probable:** el model va retornar ordinals fora del rang disponible; `run-matching.ts` filtra els ordinals inexistents però permet desar el candidat sense cap enllaç.
- **Impacte:** la justificació no és auditable des de la font oficial. No s'hauria d'aprovar sense regenerar-la.
- **Correcció recomanada:** impedir que un candidat es desi sense almenys un fragment vàlid, marcar el job com a error reintentable i regenerar només aquests tres matchings després d'autorització.

### A2. Errors documentals heretats — mitjana

- **Quantitat:** 27.732 registres pendents: 1.668 contractacions, 608 convenis, 11.257 RAISC CCAA i 14.199 RAISC local.
- **Evidència:** `processing_status=pendent`, `evidence_status=error`, `evidence_error=NULL` i cap job executat.
- **Causa confirmada:** la migració `20260901173000_independent_record_stages.sql` va assignar `error` a qualsevol registre amb algun `source_document`, inclosos documents només `discovered` que mai s'havien intentat descarregar.
- **Impacte:** confon “URL descoberta” amb “extracció fallida”, distorsiona mètriques i filtres, encara que el procés automàtic pot reintentar-los.
- **Correcció recomanada:** migració de dades reversible que torni a `pending` exclusivament els registres pendents, sense jobs, sense documents intentats i amb `evidence_error IS NULL`; conservar els errors reals.

### A3. Job històric aprovat amb preparació pendent — mitjana

- **Quantitat:** 1 job (`ba55bdcd-3803-45c3-b130-211863206ddc`).
- **Evidència:** `status=approved` i `preparation_status=pending`.
- **Causa probable:** job creat abans d'introduir `preparation_status`; el backfill no el va normalitzar.
- **Impacte:** el resultat i la provisió són coherents, però el detall històric de fase és fals.
- **Correcció recomanada:** backfill puntual a `ready`, condicionat a candidat, revisió positiva i evidència existent.

### A4. `completed_at` ambigu en lots pendents de revisió — mitjana

- **Quantitat:** 13 dels 16 lots en `needs_review`.
- **Evidència:** `status=needs_review`, `stage=review` i `completed_at` informat.
- **Causa confirmada:** l'orquestrador usa `completed_at` per indicar que ha acabat el processament automàtic, mentre altres funcions el tracten com a finalització global del lot.
- **Impacte:** no hi ha pèrdua de dades, però informes o integracions poden interpretar el lot com completament revisat.
- **Correcció recomanada:** definir `processing_completed_at` i reservar `completed_at` per al final de la revisió, o documentar i aplicar una única semàntica a tot el codi.

### A5. Identitats duplicades — baixa, revisió necessària

- **Quantitat:** 865 files en 351 clústers; clúster màxim de 56 files.
- **Evidència:** comparteixen `deduplication_key`; no hi ha clústers entre datasets ni cap clúster amb un membre processat.
- **Interpretació:** poden ser actes administratius repetits o files realment duplicades. La clau funciona com a barrera de matching, no com a prova suficient per eliminar files.
- **Correcció recomanada:** revisar clústers amb més volum i reforçar la identitat amb identificadors administratius quan existeixin. No eliminar automàticament.

## Comprovacions sense incidències

- 0 claus foranes trencades o files òrfenes en les 25 taules auditades.
- 0 registres sense tipologia, deduplication key o traçabilitat obligatòria.
- 0 documents amb `chunk_count` diferent dels fragments reals.
- 0 documents `fetched` sense hash, text o mètode d'extracció.
- 0 fragments amb longitud o hash obligatori buit.
- 0 enriquiments sense evidència o amb evidència d'un altre registre.
- 0 candidats amb codi inexistent, nom discrepant, ranks no contigus o evidència creuada.
- 0 provisions sense decisió positiva vigent o amb relacions creuades.
- 0 recomptes de lot discrepants respecte als jobs.
- 0 tasques actives, fallides o amb timestamps incompatibles; les 25 estan completades.
- 0 exportacions amb recompte diferent dels seus elements.
- 0 mencions d'entitat amb estat de resolució incompatible amb `entity_id`.

## Restriccions absents al model

PostgreSQL no limita els dominis de `pipeline_jobs.status`, `pipeline_jobs.preparation_status`, `pipeline_runs.status`, `pipeline_runs.stage` ni `source_records.financing_type`. El codi actual usa valors coherents, però una escriptura directa podria crear estats impossibles.

Es recomana afegir constraints en una migració posterior, després de normalitzar A2–A4. També convé afegir una regla o trigger que exigeixi almenys una evidència per candidat abans de passar el job a `needs_review`.

## Limitacions

- L'auditoria valida estructura, relacions, metadades, estats i traçabilitat; no determina si el contingut semàntic de cada matching és correcte. Això requereix revisió humana.
- No s'han descarregat de nou les 52.530 URL ni s'ha contrastat el seu contingut actual amb Internet.
- Els hashes s'han comprovat com a presents i les longituds contra el text persistit; no s'han recalculat tots els SHA-256 per evitar una lectura i còmput innecessaris sobre contingut documental.
- No s'han auditat esquemes gestionats per Supabase (`auth`, `storage`, etc.); l'abast funcional és l'esquema `public` de l'aplicació.
- No s'ha modificat cap dada ni cap conjunt identificat com a v3.

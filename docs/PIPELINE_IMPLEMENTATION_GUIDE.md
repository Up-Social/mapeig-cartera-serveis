# Guia tècnica del pipeline actual

Aquest document descriu la implementació vigent del PoC. El codi, les migracions i els tests del repositori són la font de veritat si apareix una discrepància.

## Arquitectura

```text
Excel i fonts públiques
  → source_records + procedència immutable
  → source_documents + evidence_chunks
  → record_enrichments
  → matching_candidates
  → revisió humana
  → service_provisions
  → exportacions Excel
```

La web és una aplicació Next.js amb App Router. Supabase aporta Postgres i l'API de dades. En desenvolupament s'utilitza Supabase local sobre Docker; la web desplegada i el worker extern poden apuntar a un projecte Supabase remot.

## Àrees de la web

- **Registres (`/`)**: consulta, filtres, detall de la fila original, documents, enriquiment, candidats i procés individual.
- **Lots (`/batches`)**: creació de lots automàtics d'1 a 50 identitats úniques, progrés persistent, substitució d'incidències i exportació per lot.
- **Revisió (`/review`)**: aprovació, correcció, rebuig o evidència insuficient.
- **Aprovats (`/approved`)**: consulta i exportació de provisions vigents.
- **Catàleg (`/catalog`)**: serveis importats, provisions i relacions amb entitats.
- **Entitats (`/entities`)**: entitats normalitzades, mencions, serveis RESES i relacions amb el catàleg.
- **Procés (`/process`)**: metodologia, estat auditat, fonts i límits del PoC.

Totes les rutes, APIs i accions estan protegides per `APP_ACCESS_PASSWORD`, excepte la pantalla i l'endpoint d'accés. La sessió utilitza una cookie `HttpOnly`, `SameSite=Strict` i segura en producció.

## Dades d'entrada

Els Excel consolidats de contractació, convenis i RAISC s'utilitzen per validar la ingesta i el pipeline. Cada fila conserva dataset, fitxer, full, número de fila, identificador original, empremta estable, `source_payload` i tipologia normalitzada.

La reimportació fa `upsert` per `(source_dataset, source_record_id)`. Les fórmules del Master no es mostren ni s'envien al model.

El connector d'e-Tauler descobreix i pot importar actes de concert social o gestió delegada. Cada acte és un esdeveniment administratiu; la seva existència no implica automàticament finançament nou.

RESES és una font auxiliar per normalitzar entitats, establiments, tipologies, territori i capacitat. No acredita per si sola que una provisió financi un servei concret.

## Lots i deduplicació

La selecció automàtica es fa dins de Supabase de manera atòmica. Un lot conté entre 1 i 50 casos i reparteix la mostra entre les tipologies disponibles. S'exclouen els registres que ja han format part d'un lot, les variants amb la mateixa `deduplication_key` i els casos que no compleixen l'estat admès pel flux.

També existeix el flux individual des de **Registres**, que crea un lot d'un sol cas i executa el mateix procés persistent.

## Procés automàtic

`process_run` encadena quatre fases reintentables:

1. **Preparació documental**: descobreix URL, descarrega HTML/PDF, extreu text i crea fragments.
2. **Enriquiment**: extreu camps estructurats exclusivament des dels fragments oficials.
3. **Matching**: compara l'evidència amb els 140 serveis autoritzats i proposa fins a tres candidats.
4. **Revisió**: deixa els casos correctes pendents d'una decisió humana.

Un error individual no atura la resta del lot. El procés conserva comptadors, fase, heartbeat, missatges d'error i intents. Les etapes ja resoltes es reutilitzen en un reintent.

En desenvolupament, les accions poden iniciar els scripts localment. Amb `NODE_ENV=production` o `WORKER_EXECUTION_MODE=queue`, la web només crea una tasca a `worker_tasks`. `scripts/run-worker.ts` reclama una tasca de manera atòmica, recupera tasques abandonades i reintenta `process_run` fins a tres vegades.

## Evidència i matching

La preparació, l'enriquiment i el matching són capes separades:

- `source_documents` i `evidence_chunks` conserven la font i els fragments;
- `record_enrichments` conserva camps contrastats i la seva evidència;
- `matching_candidates` conserva codi, nom, rank, puntuació, explicació, motor i versió;
- `matching_candidate_evidence` vincula cada proposta amb fragments del mateix registre.

El model no pot crear codis inexistents ni decidir imports. Un candidat sense ordinal d'evidència vàlid invalida el resultat nou. La confiança és informativa i no substitueix la revisió humana.

El catàleg Master només es pot utilitzar quan la configuració i l'autorització explícita coincideixen:

```env
MATCHING_CATALOG_SOURCE=master
ALLOW_MASTER_MATCHING=true
```

## Revisió i provisions

La revisió pot aprovar un candidat, corregir-lo seleccionant qualsevol servei admès, rebutjar el matching o declarar evidència insuficient.

Les decisions es desen separadament de la proposta automàtica. Només una aprovació o correcció crea o actualitza `service_provisions`. Rectificar una decisió conserva l'historial i sincronitza la provisió vigent.

## Exportacions

Les exportacions parteixen de `service_provisions`, mai de les propostes pendents:

- **per lot**: `Detalle_Provisiones` amb les provisions vigents quan el lot ja en té almenys una;
- **selecció d'aprovats**: entre 1 i 5.000 provisions visibles o filtrades;
- **Master complet**: còpia del fitxer indicat per `MASTER_EXCEL_PATH`, amb totes les provisions vigents.

Els llibres independents contenen els 12 camps operatius i afegeixen el nom del servei de Cartera; conserven dates, imports i hipervincles. La còpia completa del Master manté les 12 columnes de la seva plantilla. Les exportacions i els seus ítems queden registrats amb hash. El fitxer Master original no es modifica.

## Entitats i RESES

La normalització d'entitats separa mencions, aliases i entitats canòniques. Les relacions amb registres conserven el rol (`provider`, `beneficiary`, `contractor`, `signatory`, `holder` o `funder`) i l'origen. Les relacions RESES amb el catàleg són auxiliars fins que es confirmen; no generen provisions econòmiques.

## Migracions i integritat

Qualsevol canvi de base de dades passa per una migració timestampada de `supabase/migrations`. No s'ha d'executar `supabase db reset` sense autorització explícita perquè elimina les dades locals.

L'auditoria es pot repetir amb `npm run audit:data`. La fotografia de dades del 2 de setembre de 2026 és a `DATA_INTEGRITY_AUDIT.md`; els seus recomptes són històrics.

## Comprovació del repositori

El projecte utilitza Node.js 24 i npm. La comprovació completa és:

```bash
npm ci
npm run verify
```

`verify` executa lint, generació i comprovació de tipus, tests i build de producció. GitHub Actions executa les mateixes etapes en cada pull request i actualització de `main`.

# Desenvolupament i desplegament

> Revisió documental 28/10/2026: consulteu [l’estat i els límits actualitzats](ESTADO_ACTUAL_2026_10_28.md). Els resultats i recomptes datats d’aquest document són històrics; el codi i les migracions prevalen en cas de discrepància.

Guia operativa de l'arquitectura actual. El repositori és una aplicació Next.js desplegable, amb migracions Supabase, CI i Vercel Workflows/Sandbox per a les operacions llargues en producció.

## Arquitectura per entorn

### Desenvolupament local

Fora d’ús des del 02/11/2026: no s’inicien Supabase local ni Docker. Es permeten comprovacions lleugeres de codi sense serveis. `.env.local` pot apuntar a Supabase de producció: una web o un script locals no impliquen dades aïllades. L’esquema anterior (Next.js local → Supabase local amb Docker) es conserva a l’historial de Git.

Per defecte, les accions de procés iniciades des de la web local executen el despatx immediat. El mode `queue` permet provar un worker local; no reprodueix l’executor de Vercel Workflows.

### Web desplegada

```text
Navegador → Vercel → Supabase remot
                    ↓ worker_tasks
              Vercel Workflows → Sandbox temporal
```

Vercel executa les tasques persistents mitjançant Workflows i Sandbox; Supabase conserva la cua i els checkpoints. Vegeu [CLOUD_BATCHES.md](CLOUD_BATCHES.md) i [l’incident de storage](STORAGE_VERCEL_2026_10.md).

## Requisits

- Node.js 24, fixat a `.nvmrc` i `package.json`;
- npm i `package-lock.json`;
- Docker Desktop i Supabase CLI: no necessaris mentre Supabase local estigui fora d’ús (02/11/2026);
- `pdftotext` per extreure PDF;
- compte i projecte Vercel per a la web desplegada;
- projecte Supabase remot per a l'entorn desplegat.

## Arrencada local

Fora d’ús des del 02/11/2026 (vegeu [context del projecte](PROJECT_CONTEXT.md)). Les ordres anteriors (`supabase start`, `supabase migration up --local`, `supabase status`) es conserven a l’historial de Git i no s’han d’executar. No executis mai `supabase db reset` sense autorització explícita: elimina dades.

## Variables d'entorn

| Variable | Web local | Vercel | Worker | Propòsit |
|---|---:|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí | sí | URL del projecte Supabase de l'entorn |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sí | sí | sí | clau publicable |
| `SUPABASE_SECRET_KEY` | sí | sí | sí | operacions privilegiades de servidor |
| `APP_ACCESS_PASSWORD` | sí | sí | no necessària | accés compartit a la web |
| `WORKER_EXECUTION_MODE` | opcional | `vercel_workflow` | opcional | selecciona l’executor; `disabled` pausa el processament |
| `OPENAI_API_KEY` | si es processa | sí, si es processa | sí | enriquiment i matching |
| `OPENAI_MATCHING_MODEL` | si es processa | sí, si es processa | sí | model explícit |
| `MATCHING_CATALOG_SOURCE` | si es processa | no necessària | sí | catàleg autoritzat |
| `ALLOW_MASTER_MATCHING` | si s'autoritza | no necessària | sí | autorització addicional del Master |
| `MASTER_EXCEL_PATH` | per exportar Master | no recomanada | opcional | ruta local al fitxer original |

No versionis `.env.local`, claus, contrasenyes ni fitxers amb dades. Cap secret pot portar el prefix `NEXT_PUBLIC_`.

### Model OpenAI

Des del 15/10/2026, configura `OPENAI_MATCHING_MODEL=gpt-6-luna` als executors locals i als entorns Vercel Production i Preview. En l'executor cloud actual, les crides es fan als workflows de Vercel: calen `OPENAI_API_KEY` i `OPENAI_MATCHING_MODEL` també a Vercel. No hi ha Edge Functions de Supabase que consumeixin OpenAI.

Les crides passen per Responses API amb JSON Schema estricte, `reasoning.effort=none` i `service_tier=default`. Es mantenen els prompts i els límits de sortida. Abans de publicar el codi, aplica la migració `openai_luna_pricing`: admet el model nou, reserva el pressupost amb una cota conservadora de l'entrada i desa la tarifa utilitzada. Conserva les reserves i els costos històrics; no reprocessa registres.

```bash
vercel env update OPENAI_MATCHING_MODEL production --value gpt-6-luna --scope upsocial --project mapeig-cartera-serveis --yes
vercel env update OPENAI_MATCHING_MODEL preview --value gpt-6-luna --scope upsocial --project mapeig-cartera-serveis --yes
```

Els canvis de variables requereixen un desplegament complet posterior. No canviïs secrets de Supabase per aquesta migració: la base només calcula reserves i costos. La reversió compatible consisteix a tornar a la versió anterior del codi i a la configuració anterior del model, conservant la migració additiva i els rebuts. La retirada de GPT-4o mini està anunciada per al 14/01/2027; no s'ha de considerar una alternativa després d'aquesta data.

Fonts oficials: [model i tarifes de GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [retirada de models](https://developers.openai.com/api/docs/deprecations). Els imports interns són USD i la pantalla de costos manté la conversió a EUR existent.

## Accés a la web

`APP_ACCESS_PASSWORD` és obligatòria. La protecció cobreix pàgines, APIs i accions de servidor; només queden públiques la pantalla i l'endpoint d'accés. La sessió dura set dies en el mateix navegador i es desa en una cookie `HttpOnly`, `SameSite=Strict` i `Secure` en producció.

Utilitza una contrasenya llarga i única per entorn. Canviar-la invalida les sessions existents. Aquesta protecció és adequada per al PoC intern, però no substitueix un sistema d'identitats i permisos si el producte s'obre a diversos usuaris.

## Migracions

Els canvis de base de dades es versionen amb el codi. Abans de preparar una entrega cal distingir les migracions aprovades dels experiments locals.

**Paquet de Concerts del 02/11/2026:** selecció explícita de 46 migracions sobre una base remota de 112 versions; 39 candidates queden excloses de l'aplicació. Els experiments 310, 320, 330 i 340 es conserven a `supabase/experiments/migrations/`. No executeu `supabase db push` sobre tot l'arbre: altres candidates encara són al directori actiu i no formen part d'aquesta entrega.

El manifest local és `docs/local/concert-release-selected.json`; l'artefacte transaccional, els hashes i el procediment d'aplicació són a `docs/local/concert-release-2026-11-02.sql`, `docs/local/concert-release-sql-artifact-2026-11-02.json` i `docs/local/concert-release-apply-2026-11-02.md`. `node scripts/validate-concert-release-manifest.mjs` comprova integritat i dependències sense connectar-se a cap base. Aquests artefactes de treball són locals i no es publiquen a Git.

El generador històric `scripts/prepare-release-migrations.ts` continua desactivat. Supabase local i Docker queden fora d'ús per decisió de l'usuari; no iniciar-los per preparar ni verificar aquesta entrega.

Entorn remot: després de l'autorització, confirmar projecte, còpia de seguretat i historial exacte; pausar i drenar el processament; aplicar només el paquet revisat en una transacció; comprovar les 158 versions resultants i publicar el desplegament complet compatible. Un error anterior al COMMIT reverteix el conjunt. Una resposta incerta requereix consultar l'historial abans de repetir. Després del COMMIT, mantenir la pausa davant incidències i preparar una correcció compatible; no assumir que tornar al codi anterior reverteix la base.

Revisa sempre una migració abans d'aplicar-la. Els canvis destructius han d'utilitzar una estratègia en fases: afegir, migrar i verificar; retirar l'estructura antiga en una entrega posterior.

## Verificació i CI

Abans d'integrar un canvi:

```bash
npm run verify
```

La comanda executa lint, tipus, tests i build. `.github/workflows/ci.yml` repeteix aquestes etapes amb Node.js 24 en cada pull request i cada actualització de `main`.

## Desplegament de la web a Vercel

El directori arrel del projecte Vercel és l'arrel del repositori, no `apps/web`. El preset és Next.js i les ordres provenen de `package.json`.

Configura les variables necessàries per a Vercel Workflows, incloses les d’OpenAI al servidor, segons [CLOUD_BATCHES.md](CLOUD_BATCHES.md). Una publicació o canvi remot requereix autorització específica.

Flux recomanat:

1. Treballar a `main`; qualsevol branca requereix autorització expressa prèvia.
2. Revisar els canvis, executar les comprovacions proporcionals i validar amb dades aïllades.
3. Demanar autorització separada abans de cada commit i push; confirmar les migracions i el desplegament remot amb l’usuari.
4. Desplegar completament, comprovar CI, configuració i estat remot, i validar els fluxos autoritzats. Un Preview no ha d’utilitzar la base de producció.

No permetis que un Preview apunti a la base de producció.

## Worker local o de cua explícita

Aquest worker no és el consumidor ordinari de producció. Abans d’executar-lo cal verificar el destí de `.env.local` i obtenir autorització si pot escriure en remot:

```bash
npm run worker:run
```

Per reclamar com a màxim una tasca i sortir:

```bash
npm run worker:run -- --once
```

Processa una tasca cada vegada, actualitza el heartbeat, recupera tasques interrompudes després de 30 minuts i reintenta `process_run` fins a tres vegades. El LaunchAgent disponible a `ops/launchd` permet mantenir-lo actiu en macOS; consulta `WORKER_OPERATIONS.md`.

## Criteris abans de producció

- CI passa des d'una instal·lació neta.
- No hi ha secrets ni dades personals al repositori o a l'historial Git.
- Preview i producció utilitzen projectes Supabase separats.
- Les migracions estan aplicades i verificades abans del codi que en depèn.
- `APP_ACCESS_PASSWORD` és única i està configurada.
- Les operacions llargues només creen `worker_tasks` des de Vercel.
- Executor cloud, inventari de Sandbox i controls de processament verificats; no activar un worker local de producció per defecte.
- S'han comprovat reintents, idempotència i recuperació de tasques abandonades.
- Les exportacions només inclouen decisions positives vigents.
- Hi ha còpies de seguretat i un procediment de restauració provat.

## Tornada enrere

Per a la web, restaura l'últim desplegament sa o reverteix el canvi en Git. Per a la base de dades, evita desfer automàticament migracions que ja han transformat dades; detén les escriptures afectades i aplica una migració correctiva cap endavant. Restaura una còpia només després d'avaluar la pèrdua de dades posteriors.

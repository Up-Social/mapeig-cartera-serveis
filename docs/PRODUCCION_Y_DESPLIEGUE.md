# Desenvolupament i desplegament

Guia operativa de l'arquitectura actual. El repositori és una aplicació Next.js desplegable, amb migracions Supabase, CI i un worker TypeScript extern per a les operacions llargues.

## Arquitectura per entorn

### Desenvolupament local

```text
Navegador → Next.js local → Supabase local (Docker)
                         ↘ scripts TypeScript locals
```

Per defecte, les accions de procés iniciades des de la web local executen el despatx immediat. Es pot provar el comportament de producció amb `WORKER_EXECUTION_MODE=queue` i `npm run worker:run`.

### Web desplegada

```text
Navegador → Vercel → Supabase remot
                    ↓ worker_tasks
              worker TypeScript en macOS
```

Vercel executa la web i operacions curtes. No manté processos Node.js llargs després d'una petició. La preparació, l'enriquiment i el matching complet es desen a `worker_tasks`; el worker extern reclama i executa les tasques contra el mateix Supabase remot.

## Requisits

- Node.js 24, fixat a `.nvmrc` i `package.json`;
- npm i `package-lock.json`;
- Docker Desktop i Supabase CLI per al desenvolupament local;
- `pdftotext` per extreure PDF;
- compte i projecte Vercel per a la web desplegada;
- projecte Supabase remot per a l'entorn desplegat.

## Arrencada local

```bash
npm ci
supabase start
cp .env.example .env.local
supabase migration up --local
npm run dev
```

Completa `.env.local` amb els valors retornats per `supabase status`. La web queda a `http://localhost:3000` i Studio a `http://localhost:54323`.

No executis `supabase db reset` sense autorització explícita: elimina les dades locals. Per aplicar només les migracions pendents utilitza `supabase migration up --local`.

## Variables d'entorn

| Variable | Web local | Vercel | Worker | Propòsit |
|---|---:|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí | sí | URL del projecte Supabase de l'entorn |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sí | sí | sí | clau publicable |
| `SUPABASE_SECRET_KEY` | sí | sí | sí | operacions privilegiades de servidor |
| `APP_ACCESS_PASSWORD` | sí | sí | no necessària | accés compartit a la web |
| `WORKER_EXECUTION_MODE` | opcional | `queue` recomanat | opcional | força la cua persistent |
| `OPENAI_API_KEY` | si es processa | no necessària | sí | enriquiment i matching |
| `OPENAI_MATCHING_MODEL` | si es processa | no necessària | sí | model explícit |
| `MATCHING_CATALOG_SOURCE` | si es processa | no necessària | sí | catàleg autoritzat |
| `ALLOW_MASTER_MATCHING` | si s'autoritza | no necessària | sí | autorització addicional del Master |
| `MASTER_EXCEL_PATH` | per exportar Master | no recomanada | opcional | ruta local al fitxer original |

No versionis `.env.local`, claus, contrasenyes ni fitxers amb dades. Cap secret pot portar el prefix `NEXT_PUBLIC_`.

## Accés a la web

`APP_ACCESS_PASSWORD` és obligatòria. La protecció cobreix pàgines, APIs i accions de servidor; només queden públiques la pantalla i l'endpoint d'accés. La sessió dura set dies en el mateix navegador i es desa en una cookie `HttpOnly`, `SameSite=Strict` i `Secure` en producció.

Utilitza una contrasenya llarga i única per entorn. Canviar-la invalida les sessions existents. Aquesta protecció és adequada per al PoC intern, però no substitueix un sistema d'identitats i permisos si el producte s'obre a diversos usuaris.

## Migracions

Tots els canvis de base de dades neixen a `supabase/migrations` i es versionen amb el codi.

Desenvolupament local:

```bash
supabase migration up --local
```

Entorn remot:

```bash
supabase link --project-ref ID_DEL_PROJECTE
supabase db push
supabase migration list
```

Revisa sempre una migració abans d'aplicar-la. Els canvis destructius han d'utilitzar una estratègia en fases: afegir, migrar i verificar; retirar l'estructura antiga en una entrega posterior.

## Verificació i CI

Abans d'integrar un canvi:

```bash
npm run verify
```

La comanda executa lint, tipus, tests i build. `.github/workflows/ci.yml` repeteix aquestes etapes amb Node.js 24 en cada pull request i cada actualització de `main`.

## Desplegament de la web a Vercel

El directori arrel del projecte Vercel és l'arrel del repositori, no `apps/web`. El preset és Next.js i les ordres provenen de `package.json`.

Configura a Vercel les variables de Supabase remot, `APP_ACCESS_PASSWORD` i `WORKER_EXECUTION_MODE=queue`. Les claus d'OpenAI poden quedar exclusivament al worker perquè la web només crea tasques persistents.

Flux recomanat:

1. Crear una branca des de `main`.
2. Desenvolupar i afegir migracions si cal.
3. Executar `npm run verify`.
4. Obrir un pull request i esperar que CI quedi verd.
5. Validar el Preview amb un Supabase que no sigui producció.
6. Aplicar i verificar les migracions remotes.
7. Fusionar a `main` i desplegar la web.
8. Fer una prova d'accés, consulta, creació d'una tasca i exportació.

No permetis que un Preview apunti a la base de producció.

## Worker de producció

El worker s'executa des d'un ordinador amb el repositori i `.env.local` configurat:

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
- El worker està actiu i apunta al mateix Supabase que la web.
- S'han comprovat reintents, idempotència i recuperació de tasques abandonades.
- Les exportacions només inclouen decisions positives vigents.
- Hi ha còpies de seguretat i un procediment de restauració provat.

## Tornada enrere

Per a la web, restaura l'últim desplegament sa o reverteix el canvi en Git. Per a la base de dades, evita desfer automàticament migracions que ja han transformat dades; detén les escriptures afectades i aplica una migració correctiva cap endavant. Restaura una còpia només després d'avaluar la pèrdua de dades posteriors.

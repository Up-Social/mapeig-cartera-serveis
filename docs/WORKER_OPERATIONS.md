# Worker de producción en macOS

La web desplegada en Vercel guarda las operaciones largas en `worker_tasks`.
El LaunchAgent `com.upsocial.mapeig-worker` procesa esa cola desde el Mac y se
inicia automáticamente al abrir la sesión del usuario.

## Estado

```bash
launchctl print gui/$(id -u)/com.upsocial.mapeig-worker
```

El campo `state = running` indica que está activo. El proceso carga las
variables privadas directamente desde `.env.local` mediante el script npm.
La configuración debe apuntar al mismo Supabase remoto que utiliza la web y
debe incluir las variables de OpenAI y la autorización del catálogo cuando se
ejecuten enriquecimiento y matching.

## Logs

```bash
tail -f ~/Library/Logs/mapeig-worker.log
tail -f ~/Library/Logs/mapeig-worker.error.log
```

## Reinicio

```bash
launchctl kickstart -k gui/$(id -u)/com.upsocial.mapeig-worker
```

## Desinstalación

```bash
launchctl bootout gui/$(id -u)/com.upsocial.mapeig-worker
rm ~/Library/LaunchAgents/com.upsocial.mapeig-worker.plist
```

Si cambia la ubicación del repositorio, de Volta o de npm, se debe actualizar
`ops/launchd/com.upsocial.mapeig-worker.plist` y volver a instalar el servicio.

Para una ejecución manual sin LaunchAgent:

```bash
npm run worker:run
```

El worker procesa una tarea cada vez, actualiza su señal de vida, recupera
tareas interrumpidas después de 30 minutos y reintenta `process_run` hasta tres
veces. `npm run worker:run -- --once` procesa como máximo una tarea y termina.
## Recuperació traçable i proves aïllades (18/09/2026)

Una recuperació tècnica sense resultat conserva el treball i crea un intent. Un reanàlisi amb resultat crea un treball nou amb `previous_job_id`. Les quatre classificacions són terminals encara que no tinguin candidats. `provider_calls` i els checkpoints cloud conserven respostes; un estat `sending` sense resultat conegut bloqueja la repetició automàtica. No esborreu el checkpoint ni torneu a enviar la petició per solucionar una resposta desconeguda.

Proves locals: `npm run test:db`, `npm run test:app`, `npx tsx scripts/workflow-test-sql.ts`, `npx tsx scripts/workflow-test-replay.ts`, `npx tsx scripts/workflow-test-rerun.ts` i `npx tsx scripts/workflow-test-integration.ts`. Els scripts no llegeixen `.env.local`; exigeixen projecte `cartera-workflow-test`, API loopback 55421 i proveïdor `mock`. El replay crea una base separada dins del contenedor aïllat, sense `db reset`. Les proves d’integració creen/eliminaran només fixtures marcats i objectes ficticis. La base local habitual no es modifica.

La nova cua `storage_purge_items` no conté còpies dels expedients: només rutes mínimes per completar i verificar la purga. No marqueu un element com a complet si no s’ha comprovat l’absència del fitxer. `docs/local/` recull evidències i informes no versionats.

### Seqüència de verificació local

1. Comprovar que els ports 55421/55422 són lliures o pertanyen al projecte aïllat. Iniciar-lo amb `supabase start --workdir tests/runtime` (Docker necessari); no tocar la instància habitual.
2. `npm run test:db`: migracions pendents i fixtures. `npm run test:replay`: instal·lació independent de totes les migracions des de zero i proves SQL amb rol de servidor.
3. `npm run test:app`: aplicació fictícia al port 3108. Mantenir-la oberta per a `npm run test:integration`, que comprova concurrència, API i Storage amb dades desechables.
4. `npm run test:sql` i `npm run test:rerun`: regressions transaccionals i reanàlisi mock amb invariants històriques.
5. `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:build`. L'últim invoca el build de producció amb entorn aïllat i sortida separada; no emprar el comandament general `verify` per a aquesta suite perquè no configura aquests guardes.

El preflight real és una operació diferent: `npx tsx scripts/real-batch-preflight.ts --read-only --summary` carrega la configuració real però bloqueja qualsevol petició que no sigui GET. No crea cap lot ni autoritza migracions, proveïdors o desplegaments. La creació remota comparativa continua bloquejada sense habilitació explícita; no habilitar-la sense autorització de l'usuari.

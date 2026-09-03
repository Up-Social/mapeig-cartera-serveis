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

# Ejecución de producción en Vercel

Producción usa `WORKER_EXECUTION_MODE=vercel_workflow`; local conserva sus comandos y configuración. `disabled` pausa el lanzamiento y las acciones de procesamiento. Las previsualizaciones nunca ejecutan tareas reales. No cambiar de plan automáticamente.

## Componentes

Workflows recibe únicamente el UUID de la tarea. Supabase conserva reservas, generaciones, respuestas privadas y avances. Sandbox recibe solo el documento y ejecuta Poppler/Tesseract sin acceso de red ni claves de la aplicación. Imagen preparada por `scripts/prepare-cloud-sandbox.ts`; configurar el identificador inmutable en `CLOUD_SANDBOX_SNAPSHOT`.

Variables exclusivas de producción: `WORKER_EXECUTION_MODE`, `CLOUD_SANDBOX_SNAPSHOT`, `CRON_SECRET`, además de las claves actuales de Supabase/OpenAI. Sandbox se autentica con la identidad OIDC de Vercel. No exportar esa identidad a la máquina de extracción.

La conciliación de `/api/cron/cloud` está autenticada con CRON_SECRET y se ejecuta diariamente a las 06:17 UTC. Los arranques normales son inmediatos tras encolar; un fallo de arranque puede esperar hasta la conciliación o hasta pulsar Reintentar. No promete un SLA.

## Recuperación

Una reserva caduca a los cuatro minutos. Cada unidad renueva el avance y se libera al terminar. Una generación anterior no puede guardar resultados. Las operaciones de IA y Sandbox tienen, cada una, una reserva global. OCR conserva una página por paso; cada sesión caduca a los diez minutos y los comandos tienen límites menores.

El diario previo a la llamada distingue una respuesta guardada de una petición incierta. Las respuestas guardadas se reutilizan. Una petición incierta se pausa: no se repite automáticamente. La revisión técnica debe resolverla antes de autorizar otra llamada. No se garantiza ejecución exactamente una vez de servicios externos.

La versión compatible de ejecución es CLOUD_VERSION. Cambiarla cuando se modifique el contrato de recuperación. Las ejecuciones incompatibles se pausan.

Las cuatro clasificaciones normativas completan el análisis. Las provisiones siguen requiriendo revisión humana. Las evidencias usadas por propuestas o enriquecimientos se conservan sin reemplazarlas.

## Cuotas y privacidad

Hobby limita las funciones, eventos de Workflows y Sandbox. El agotamiento bloquea nuevas operaciones sin cambiar de plan. Las llamadas a OpenAI consumen los créditos existentes. `vercel usage` devolvió 404 en esta cuenta durante la preparación: no se conoce el saldo preciso de las cuotas.

Los registros operativos contienen solo códigos técnicos. No registrar excepciones completas ni cuerpos, identificadores externos o documentos. Las entradas y salidas del workflow son también registros: devolver solo identificadores internos y estado. No adjuntar documentos o respuestas a artefactos de GitHub. El bucket `cloud-documents` y las tablas de checkpoint carecen de acceso público.

## Validación y activación

Antes de activar: lint, tipos, tests, build, SQL en base aislada y PDF/OCR sintéticos en Sandbox. Los tests SQL requieren una base `cartera_cloud_test_*` con migraciones; la base aislada de pruebas utiliza una tabla storage.buckets mínima para validar el SQL de configuración, no un servicio Storage completo.

Aplicar migraciones con copia previa de producción, desplegar con modo disabled y verificar las rutas. Después activar vercel_workflow, desactivar solamente el LaunchAgent que consume producción y ejecutar un máximo de dos registros autorizados. No borrar el entorno local ni sus comandos.

Reversión: modo disabled, conservar la cola y los puntos de reanudación. No revertir migraciones ni arrancar automáticamente el consumidor del Mac.

Comprobaciones anteriores a la activación: SQL de reservas/caducidad/exclusión del worker local y transacciones con 51 registros; simulación de respuesta reutilizada, petición incierta y máximo de tres peticiones limitadas; PDF y OCR sintéticos en un Sandbox remoto. La validación end-to-end real y su consumo se documentan en el informe de despliegue.

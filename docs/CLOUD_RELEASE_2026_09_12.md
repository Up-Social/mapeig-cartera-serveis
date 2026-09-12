# Verificación de ejecución remota — 12 de septiembre de 2026

Informe inicial. Las correcciones técnicas posteriores se documentan en [el cierre de validación](CLOUD_FINAL_VALIDATION_2026_09_12.md).

## Resultado observado

Producción utiliza Vercel Workflows y Supabase. El LaunchAgent `com.upsocial.mapeig-worker` que consumía producción quedó detenido. No se modificó `.env.local` ni se eliminaron comandos locales. Advertencia operativa: esa configuración local existente apunta a producción y usa cola; no equivale a una base local independiente.

Se ejecutaron exactamente dos registros reales. El lote `6d476cab-6c11-4521-a9ea-9b46f2bfb175` llegó a revisión con `insufficient_evidence`. La respuesta original proponía fuera de cartera sin acreditar el alcance; se conservó privada y se recuperó sin otra llamada de IA, aplicando la regla conservadora de evidencia insuficiente.

El lote `9682d72b-047f-4ab0-a55f-9a5a2027fa4e` quedó con una incidencia de validación: la respuesta incluía un agrupador. No se sustituyó por un hijo ni se persistió el candidato. No se considera un matching válido.

La segunda solicitud se dejó persistida sin arranque, con una reserva vencida. La conciliación autenticada la recuperó. Un intento posterior de escritura del propietario antiguo fue rechazado. El primer resultado se recuperó desde el diario privado tras un despliegue compatible. Ambos procesos avanzaron sin consumidor del Mac; el cliente HTTP que los inició no mantenía una conexión abierta.

## Consumo de la muestra

Cuatro respuestas recibidas: dos enriquecimientos y dos matching. 208.754 tokens de entrada y 1.361 de salida. Estimación según tarifa publicada de gpt-4o-mini: **0,0321297 USD**. Es una estimación a partir del uso devuelto, no un importe facturado ni una previsión mensual. La recuperación no generó nuevas llamadas. Las respuestas rechazadas también deben contabilizarse; la corrección de uso persistente incorpora esa condición.

El Sandbox remoto procesó PDF y OCR sintéticos. El snapshot preparado es `snap_UUrKz3eWBqpSzHV4XUQ1YJ1Snqbw`. No se cambió ningún plan. `vercel usage` devolvió 404: **saldo exacto de cuotas pendiente de comprobación en la cuenta**. No se garantiza capacidad gratuita para toda la base.

## Comprobaciones

- 72 pruebas de Node satisfactorias, incluyendo recuperación de OCR por páginas con sesiones simuladas, reuso de respuestas, petición incierta, cuota, elegibilidad y resultados normativos.
- SQL en una base aislada: reservas exclusivas, generaciones antiguas, 51 registros, transacciones de enriquecimiento, creación guiada e individual, arranque repetido y uso sin duplicación. La prueba de Storage usa una tabla mínima; no sustituye una prueba completa del servicio Storage.
- Extracción textual y OCR catalán/castellano reales con documento sintético en Sandbox Linux.
- Tipos, lint y compilación Next comprobados; GitHub conserva únicamente CI.
- Revisión de escritorio y móvil. El renderizado de fechas se fija a Europe/Madrid para evitar diferencias entre servidor y navegador.
- En 42 registros operativos de la muestra no se encontraron valores documentales de los dos expedientes. Los pasos intercambian UUID y estados, sin documentos ni respuestas de IA.
- Antes y después: 28.124 registros fuente, 29 provisiones, 322 candidatos históricos y 32 decisiones de revisión. No se crearon provisiones, no se reclasificó el histórico.

## Migraciones y conservación

Migraciones aditivas desde `20260913090000` hasta `20260913102000`: ejecución, dispatch, documentos privados, integridad, selección, entradas individuales/guiadas, uso del proveedor y finalización de fases.

Copia previa de esquema y datos conservada fuera del repositorio de la aplicación, en la carpeta privada `snapshots/production-before-cloud-2026-09-12` del espacio de documentación. Permisos restringidos; excluida de Git. No se reseteó la base local existente.

Siete commits iniciales: `44314cb`, `c0d77e4`, `0e3290c`, `9b236a1`, `5c1e023`, `e1bd5fb`, `30f43b1`. Corrección posterior de entradas y alcance: `fbac949`. Los ajustes finales de uso, paginación, fechas y finalización se identifican por el commit que incorpora este informe.

## Límites y seguimiento

La muestra demuestra ejecución y recuperación remota, no calidad de matching positivo sobre una base amplia. Un caso requiere revisión por falta de evidencia; otro falló correctamente la validación. No se autorizaron reprocesamientos masivos y no se realizaron.

Los fallos de arranque pueden esperar a la conciliación diaria, o recuperarse expresamente desde la interfaz. Las peticiones externas de resultado incierto requieren revisión técnica; no se repiten a ciegas. La cuota exacta y el consumo agregado de Vercel siguen pendientes de verificación en la cuenta.

Los documentos originales y los checkpoints privados se conservan para trazabilidad y recuperación. Los archivos de trabajo de Sandbox desaparecen con la sesión. No se aplica todavía una política automática de caducidad a checkpoints persistentes; debe definirse con el criterio de conservación de evidencias.

Reversión: configurar `WORKER_EXECUTION_MODE=disabled` y desplegar. Se conserva la cola y las evidencias. No revertir destructivamente migraciones ni arrancar automáticamente el consumidor del Mac.

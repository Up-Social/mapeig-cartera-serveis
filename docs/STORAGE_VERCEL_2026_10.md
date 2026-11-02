# Incidente de almacenamiento de Vercel Sandbox — octubre de 2026

## Qué ocurrió

El 26 de octubre se identificaron 1.019 snapshots automáticos, con 787.262.836.767 bytes declarados en inventario. Las sesiones se creaban sin `persistent:false`: `stop()` detenía el cómputo pero dejaba snapshots. El OCR por páginas multiplicaba las sesiones. La vista inicial atribuía aproximadamente 41,34 USD de consumo acumulado del ciclo a Snapshot Storage; no es un precio mensual ni el volumen actualmente retenido. El presupuesto compartido pausó Mapeig y otros proyectos del equipo.

Con autorización expresa se eliminaron los 1.019 snapshots automáticos y se conservó la imagen base manual. Los originales documentales y checkpoints permanecen en Supabase; no se migraron snapshots de máquinas a Supabase. La eliminación fue irreversible y no debe repetirse sobre otros recursos por inferencia.

## Corrección y contención

El código centraliza Sandbox con `persistent:false`, red restringida y retención defensiva de un día. Verifica el cierre y conserva el lease ante creación incierta, cierre no confirmado o snapshot inesperado; el inventario paginado y las guardas detienen el procesamiento ante situaciones inseguras. La activación exige inventario sano y prueba sintética de PDF digital y OCR, sin reanudar tareas anteriores. La prueba sintética no certifica documentos reales ni aceptación funcional. La imagen base manual se prepara por separado; no borrar la base ni documentos privados como operación de limpieza rutinaria.

## Observaciones y acciones pendientes

El 27/10 a las 09:25 UTC el inventario registró una imagen base de 767.313.910 bytes, cero snapshots automáticos y cero máquinas activas. Era una observación puntual. El presupuesto adicional compartido estaba temporalmente en 30 USD con pausa automática; el seguimiento previsto para el 29 debía verificar el nuevo ciclo y las condiciones autorizadas para volver a 20 USD. Comprobar estado y autorización antes de cualquier cambio. Los importes mostrados por el proveedor son acumulados y pueden retrasarse o redondearse; no inferir un reembolso.

La ejecución 302 apareció pausada el 27/10 con causa `internal` no determinada. Revisar diagnóstico, checkpoints e incertidumbre de llamadas antes de decidir si procede reanudar; no atribuirla al incidente sin evidencia. Cinco pausas anteriores se clasificaron como históricas resueltas por ejecuciones posteriores, conservando su historial. No borrar checkpoints ni repetir llamadas inciertas para desbloquear una tarea.

Fuentes locales: `docs/local/ESTADO_RECUPERACION_VERCEL_2026_10_26.md`, `docs/local/SEGUIMIENTO_CONSUMO_VERCEL_2026_10_27.md`, `docs/local/REVISION_TAREAS_PAUSADAS_2026_10_26.md`; implementación en `lib/cloud/sandbox.ts`, `lib/cloud/sandbox-inventory.ts` y `lib/processing-activation.ts`. Las evidencias locales están ignoradas por Git y pueden contener detalles operativos privados.

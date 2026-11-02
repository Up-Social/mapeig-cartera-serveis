# Estado del proyecto y guía documental — 28 de octubre de 2026

Esta revisión se basa en el repositorio local `main` en `a7c9bda`, sus migraciones, documentación y evidencias locales existentes. No incluye consulta nueva del estado remoto ni una validación funcional integral. Las cifras y despliegues históricos son observaciones de su fecha, no estados garantizados hoy.

## Producto y arquitectura

Mapeig relaciona registros públicos de contratación, convenios, subvenciones y conciertos con servicios de la Cartera. La fuente, sus documentos y la evidencia se preservan; la IA propone y la persona revisa. Las decisiones, datos originales y costes no deben confundirse. El catálogo normativo versionado utiliza servicios hoja elegibles; el Master permanece como referencia separada y no se autoriza su uso para ajustar o validar matching por su importación. Véase [NORMATIVE_MATCHING.md](NORMATIVE_MATCHING.md).

La ejecución de producción documentada utiliza Vercel Workflows, Sandbox temporal y Supabase para tareas, checkpoints y documentos privados. Existe OCR para PDFs, con límites y necesidad de revisión cuando no se obtiene evidencia suficiente. El worker local es un modo separado. `.env.local` puede apuntar a producción; la ejecución local no implica datos aislados. Los cambios de datos reales, reprocesamientos y despliegues requieren autorización específica. Véanse [CLOUD_BATCHES.md](CLOUD_BATCHES.md), [PRODUCCION_Y_DESPLIEGUE.md](PRODUCCION_Y_DESPLIEGUE.md) y [STORAGE_VERCEL_2026_10.md](STORAGE_VERCEL_2026_10.md).

## Sprints y límites

Sprint 1 incorporó trabajo sobre conciertos: lectura y revisión de líneas, vínculos, evidencias y evolución económica, además de correcciones posteriores. Sprint 2 añadió el circuito de convenios: financiación pública, receptores y anualidades, exclusiones y revisión auditable; los compromisos no son pagos y las propuestas requieren validación humana. Los commits `8dfca16` y `854e467` figuran en la historia local; la publicación registrada en los informes del 19–20 de octubre no equivale a aceptación funcional. Las decisiones y validaciones de Tomàs que constan en los informes siguen pendientes de confirmación actual. No se ha comprobado aquí su cierre.

Los materiales de ambos sprints están en `sprints/` de la carpeta documental del proyecto. Los informes conservan sus fechas: una revisión anterior a una publicación no describe necesariamente la versión posterior. Los informes de ejecución y evidencias más extensas permanecen en `docs/local/`, excluido de Git.

## Incidente y seguimiento

En octubre se corrigió la acumulación de snapshots automáticos de Sandbox; el 27 de octubre se observó un inventario sin snapshots automáticos y sin máquinas activas. Ese control no prueba el estado de hoy. La ejecución 302 requería diagnóstico sin causa determinada y había seguimiento de presupuesto previsto para el 29 de octubre. Verificar su situación antes de actuar; no reanudar tareas históricas automáticamente. Detalles, costes y fuentes: [STORAGE_VERCEL_2026_10.md](STORAGE_VERCEL_2026_10.md).

## Lectura de la documentación

Los documentos de septiembre con fecha y la auditoría de integridad son fotografías históricas. Los otros documentos describen subsistemas y pueden contener detalles locales o de versiones anteriores: ante contradicciones, prevalecen código y migraciones y debe verificarse la configuración efectiva. La biblioteca de PDFs del 21 de octubre se conserva fechada; el suplemento del 28 de octubre recoge cambios posteriores sin certificar los manuales originales. No se ha ejecutado una auditoría funcional de todos los recorridos ni comprobación remota en esta actualización.

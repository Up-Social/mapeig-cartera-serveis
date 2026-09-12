# Clasificación normativa y servicios finales

## Referencia y alcance

Se utiliza el texto consolidado de consulta del Decret 142/2010 obtenido del Portal Jurídic, documento 557820, versión 2164168, fecha 2026-07-14. El propio portal indica que la consolidación no tiene carácter oficial: las publicaciones del DOGC son la fuente normativa oficial. La procedencia, URL de publicación original, enlaces de descarga y lista de afectaciones están en `data/legal/cartera.json`; el texto completo convertido está en `data/legal/cartera.md`.

La extracción inicial contiene 194 entradas. Se conservan en la procedencia las cuatro entradas del apartado 1.2.4, derogadas por la disposición derogatoria segunda del Decret llei 25/2021 (documento 913592), y se excluyen del catálogo operativo. Quedan 190 entradas, incluidos agrupadores y prestaciones económicas y tecnológicas. `validated` significa validación estructural y de integridad de la extracción, no dictamen jurídico ni garantía de cumplimiento de un expediente.

La norma define objeto, destinatarios y condiciones; el expediente acredita los hechos; el proyecto limita la asignación a hojas de prestaciones de servicio. Las exclusiones del proyecto no niegan la naturaleza social de las prestaciones económicas o tecnológicas. Los agrupadores conservan su función de contexto. El Master queda como referencia separada, accesible desde el catálogo; no alimenta el nuevo matching.

## Resultados y revisión

- `in_portfolio`: un principal, el candidato válido de mayor puntuación; hasta dos alternativas secundarias. Solo hojas de tipo servicio.
- `out_of_portfolio`: servicio social y destinatarios acreditados sin encaje en la versión validada; ningún candidato.
- `discarded`: fuera del alcance del proyecto, con motivo estructurado y evidencia; ningún candidato.
- `insufficient_evidence`: faltan hechos determinantes; ningún candidato.

La confianza es una estimación del modelo, no una probabilidad calibrada. La compatibilidad de destinatarios se exige antes de elegir el principal. La norma no se presenta como evidencia de hechos del expediente. No se han ejecutado llamadas reales de pago a la IA para esta entrega.

`persist_analysis` guarda resultado, candidatos y evidencias en una transacción. `review_analysis` guarda revisión, evaluación, estado y creación/retirada de provisión en otra transacción. Las nuevas asignaciones se validan en el servidor y mediante triggers SQL, también al corregir manualmente. Los resultados históricos no se reclasifican: se conserva su código final y su enlace al Master. Los candidatos históricos no elegibles no se ofrecen para nuevas asignaciones.

La vista `current_analysis_results` solo expone el análisis del último trabajo. `/analysis` filtra clasificaciones humanas; `/api/exports/outside` exporta los casos fuera de cartera revisados, con fuentes y versión. Las provisiones oficiales mantienen su referencia versionada; los Excel de provisiones consultan el nombre oficial y conservan la referencia histórica cuando corresponde.

## Preparación e instalación local

1. Usar una base Supabase local de pruebas. Verificar host y base antes de aplicar migraciones. No usar reset ni ejecutar contra producción.
2. Aplicar por orden las migraciones del repositorio, incluyendo las de 20260912.
3. Configurar una sesión local con `NEXT_PUBLIC_SUPABASE_URL` en loopback y una clave de servicio correspondiente a esa base. No cambiar la configuración remota ni subir credenciales.
4. Ejecutar `npm run catalog:import`. El importador rechaza hosts externos y versiones sin validar. La instalación es atómica: un fallo no desactiva el catálogo anterior. Reinstalar el mismo identificador falla sin sobrescribirlo; una versión diferente requiere nuevas fuentes y validación.
5. Seleccionar `MATCHING_CATALOG_SOURCE=official`. `npm run matching:ready` comprueba versión activa, integridad, evidencia y trabajos pendientes; no verifica saldo ni ejecuta llamadas a IA.
6. Para probar con IA real, revisar primero la muestra y estimar consumo. Las pruebas automáticas usan respuestas simuladas.

Conversión reproducible: obtener mediante POST del endpoint público `https://portaldogc.gencat.cat/eadop-rest/api/pjc/documentPJC` los parámetros `documentId=557820`, `language=ca`, `traceabilityStandard=02`, `validity=2164168`; obtener las afectaciones en `https://portaldogc.gencat.cat/eadop-rest/api/pjc/getDocumentAffectations` con los mismos parámetros. Guardar las respuestas y ejecutar `node --import tsx scripts/prepare-official-catalog.ts documento.json afectaciones.json` desde la raíz. Revisar los cambios antes de importar: la conversión falla si falta una ficha de servicio elegible o la referencia que acredita la derogación.

## Lotes

Cuota agotada o credenciales inválidas pausan el lote. Los errores transitorios tienen un máximo de tres intentos y esperas de uno y dos segundos. Los errores de validación no se reintentan automáticamente. El botón Reprendre lot crea una tarea persistente para el worker; el worker debe estar encendido. Conserva los análisis terminados y continúa las fases pendientes. No se ha demostrado que la falta de créditos causara la desaparición histórica del botón.

## Validación realizada

- ESLint sin errores ni avisos, TypeScript y compilación de producción con webpack correctos.
- 60 pruebas unitarias, incluidas jerarquía, población incompatible con alta puntuación, cuatro categorías, orden de candidatos, evidencia, último análisis y política de reintentos.
- Todas las migraciones y la importación pública aplicadas desde cero en `cartera_leaf_test_clean_20260912`, dentro del contenedor local `supabase_db_mapeig-cartera-serveis`.
- `tests/integration/classification.sql`: registros ficticios, rechazo de padre sin escritura parcial, aprobación, descarte, fuera de cartera, rectificación con historial, retirada de provisión y reanudación sin reset de resultados. Termina con rollback y rechaza bases cuyo nombre no sea de prueba.
- API sobre otra base aislada: rechazo HTTP 409 de un agrupador, aprobación válida, descarga y lectura del Excel por lote y de fuera de cartera, rutas de catálogo/aprobados/entidades/clasificaciones.
- Revisión visual de revisión, lotes y clasificaciones; escritorio y móvil de 390 px. Sin errores JavaScript ni desbordamiento horizontal tras finalizar la transición del menú.

La base habitual y su configuración permanecen intactas. Las bases de prueba solo contienen datos públicos y ficticios. No se ha hecho push ni despliegue. La validación semántica con expedientes reales y revisión experta sigue siendo un paso posterior, antes de procesar bases consolidadas.

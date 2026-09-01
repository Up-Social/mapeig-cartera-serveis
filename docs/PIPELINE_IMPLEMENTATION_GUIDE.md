# Guía de implementación del pipeline del PoC

**Nombre de la aplicación:** `Mapeig cartera de serveis.`

## 1. Propósito y límites

Esta guía define cómo construir el primer PoC con TypeScript, Next.js y Supabase. El objetivo es validar de forma medible el matching entre provisiones públicas y servicios de la Cartera, generar un Excel auditable y determinar qué casos requieren revisión humana.

El Master manual queda fuera de todo el flujo de construcción. Solo podrá leerse después de congelar el resultado del PoC, mediante un proceso de comparación separado.

El PoC será inicialmente una aplicación web local. Next.js y los procesos TypeScript se ejecutarán en el ordenador del usuario y la interfaz se abrirá en el navegador. Supabase seguirá siendo remoto para evitar instalar y mantener una base de datos local. GitHub, Vercel y la automatización de despliegues quedan fuera del primer incremento.

## 2. Arquitectura

```text
Fuentes públicas
    -> conectores TypeScript
    -> snapshots inmutables en Storage
    -> staging y normalización en Postgres
    -> descarga y extracción documental
    -> generación de candidatos
    -> reglas + similitud semántica + IA
    -> cola de revisión humana
    -> agregación jerárquica y conciliación
    -> Excel PoC e informes de calidad
```

### 2.1 Aplicación web

Next.js proporciona cuatro áreas internas:

1. **Ejecuciones:** fuente, parámetros, progreso, filas obtenidas y errores.
2. **Matching:** asignaciones propuestas, método, confianza y evidencia.
3. **Revisión:** candidato principal, alternativas y decisión humana.
4. **Resultados:** métricas, conciliaciones y descarga del Excel.

Las rutas de servidor de Next.js crean ejecuciones, consultan resultados y activan lotes controlados. El primer PoC evitará lanzar extracciones completas o miles de clasificaciones dentro de una única petición HTTP.

### 2.1.1 Mesa de procesamiento por filas

La pantalla operativa principal será una tabla paginada del lado del servidor. Cada fila mostrará:

- fuente e identificador original;
- título o descripción abreviada;
- estado de descarga y documento;
- estado de procesamiento;
- candidato principal y código de Cartera;
- confianza y método;
- estado de revisión;
- error o advertencia, si existe.

El usuario podrá seleccionar filas visibles o definir un lote filtrado y ejecutar acciones controladas:

- `Preparar documentos`;
- `Generar candidatos`;
- `Ejecutar matching`;
- `Reintentar errores`;
- `Enviar a revisión`;
- `Aprobar selección`.

Cada acción creará jobs persistentes. La tabla mostrará los cambios de estado mediante refresco incremental o suscripción, sin mantener una petición abierta durante todo el procesamiento.

Un panel lateral de detalle permitirá comparar la provisión, el fragmento documental utilizado, el candidato principal y las alternativas. La decisión humana guardará usuario, fecha, código anterior, código final y motivo.

### 2.2 Base de datos y almacenamiento

Supabase Postgres será la fuente de verdad del resultado procesado. Supabase Storage conservará:

- respuestas originales de APIs;
- descargas CSV, JSON, XML o PDF;
- documentos asociados a provisiones;
- texto extraído cuando convenga conservarlo como artefacto;
- exportaciones y manifiestos de ejecución.

Cada objeto tendrá hash, fuente, fecha de recuperación y vínculo con una ejecución. Los originales no se sobrescriben.

### 2.3 Workers

Los workers Node.js/TypeScript ejecutan unidades reintentables e idempotentes:

- descubrir páginas y totales;
- descargar una página o documento;
- parsear un registro;
- normalizar un lote;
- extraer texto;
- generar embeddings;
- clasificar un lote;
- ejecutar conciliaciones;
- generar la exportación.

Los trabajos se activarán manualmente desde la web local. La persistencia de estados en Supabase Postgres permitirá interrumpir y reanudar una ejecución sin perder el progreso al cerrar o reiniciar la aplicación.

Cada invocación procesará un lote acotado, actualizará su cursor y encolará o dejará preparado el siguiente lote. Este patrón evita depender de una función de larga duración y permite tolerar reintentos, límites de ejecución y despliegues.

## 3. Organización recomendada

```text
apps/web/                   Aplicación Next.js
packages/db/                Tipos, consultas y migraciones
packages/domain/            Modelo, vocabularios y reglas puras
packages/connectors/        RAISC, BDNS, PSCP, convenios, RESES, Cartera, e-Tauler/DOGC
packages/documents/         Descarga, extracción, segmentación y evidencia
packages/matching/          Candidatos, reglas, embeddings e IA
packages/quality/           Validaciones y conciliaciones
packages/export/            Vistas y generación del XLSX
workers/                    Procesamiento remoto por lotes
supabase/migrations/        Esquema versionado
tests/fixtures/             Casos controlados sin depender del Master manual
```

Un monorepo permite compartir tipos y reglas entre la web y los workers sin duplicarlas.

## 4. Modelo de datos mínimo

### Control de ejecuciones

- `pipeline_runs`
- `pipeline_jobs`
- `source_snapshots`
- `quality_issues`

### Datos administrativos

- `source_records`
- `provisions`
- `provision_parts`
- `entities`
- `entity_identifiers`
- `provision_entity_roles`
- `documents`
- `document_fragments`

### Referencias y matching

- `cartera_services`
- `cartera_ancestors`
- `reses_records`
- `match_candidates`
- `assignments`
- `allocations`
- `review_items`
- `review_decisions`

Las claves internas serán UUID. Cada registro normalizado conservará `source_dataset`, `source_record_id`, snapshot, localizador de origen y hash del payload.

## 5. Contrato de los conectores

Cada conector debe implementar las mismas operaciones conceptuales:

```ts
interface SourceConnector {
  discover(context: RunContext): Promise<DiscoveryResult>;
  fetchPage(input: FetchPageInput): Promise<StoredSnapshot>;
  parse(snapshot: StoredSnapshot): AsyncIterable<SourceRecord>;
  normalize(record: SourceRecord): Promise<NormalizedResult>;
  reconcile(runId: string): Promise<ReconciliationResult>;
}
```

Los conectores no clasifican servicios de la Cartera. Su responsabilidad termina cuando el contenido de origen queda representado fielmente y conciliado.

Orden recomendado de implementación:

1. Cartera oficial.
2. RAISC.
3. Convenios.
4. RESES.
5. PSCP.
6. BDNS.
7. e-Tauler/DOGC.

## 6. Procesamiento documental

Por cada URL documental:

1. resolver redirecciones y guardar metadatos HTTP;
2. almacenar el original y calcular su hash;
3. detectar el tipo real del documento;
4. extraer texto con una librería Node compatible;
5. segmentar el contenido conservando página o sección;
6. marcar `texto_insuficiente`, `inaccesible` o `requiere_ocr` cuando corresponda;
7. almacenar los fragmentos utilizados como evidencia.

El OCR no debe bloquear el primer piloto. Los documentos que lo necesiten pueden enviarse inicialmente a revisión. Solo se añadirá un componente especializado si su volumen afecta materialmente a la cobertura.

## 7. Matching híbrido con IA

### 7.1 Generación de candidatos

El sistema aplica, en orden:

1. código o denominación oficial explícitos;
2. reglas deterministas validadas;
3. vocabulario y abreviaturas controladas;
4. señales de CPV y tipologías RESES;
5. similitud semántica mediante pgvector.

El resultado debe ser un conjunto reducido, por ejemplo entre 3 y 8 candidatos.

### 7.2 Evaluación mediante IA

La IA recibe:

- texto relevante de la provisión y del documento;
- mecanismo de financiación;
- candidatos y fichas oficiales correspondientes;
- señales auxiliares separadas por fuente;
- reglas metodológicas.

Debe devolver una estructura validada con un esquema TypeScript:

- código elegido o `sin_correspondencia_suficiente`;
- evidencia textual y localizador;
- razonamiento resumido y verificable;
- alternativas;
- contradicciones;
- recomendación de revisión.

La IA no decide el importe, no convierte automáticamente una entidad en prestadora y no crea códigos inexistentes.

### 7.3 Confianza

La confianza operativa se calcula a partir de señales observables y se calibra con la muestra humana. No se usa sin más la confianza declarada por el modelo.

Solo se acepta automáticamente una asignación con evidencia cuando exista coincidencia explícita, una regla validada o se cumplan los umbrales calibrados de confianza y margen frente al segundo candidato.

## 8. Validación del matching

Se preparará una muestra mínima de 400 casos, estratificada por:

- mecanismo;
- confianza;
- presencia y calidad documental;
- nivel de la jerarquía;
- dificultad y ambigüedad.

La referencia correcta será una decisión humana basada en fuentes públicas. Se medirán:

- precisión exacta del código específico, objetivo mínimo 90 %;
- precisión jerárquica, objetivo mínimo 95 %;
- cobertura automática, objetivo mínimo 70 %;
- tasa de revisión, máximo orientativo 30 %;
- calidad de `sin_correspondencia_suficiente`;
- precisión por mecanismo y por banda de confianza;
- trazabilidad de evidencia, objetivo 100 %.

No se procesará automáticamente todo el universo hasta superar o reevaluar formalmente esta puerta de calidad.

## 9. Importes, eventos y doble conteo

El importe pertenece a `provision_parts`; la clasificación pertenece a `assignments`; el reparto pertenece a `allocations`.

- Una provisión se asigna por defecto a un único servicio.
- Los múltiples roles o entidades no multiplican filas económicas.
- Solo se divide el importe cuando la fuente publica una base explícita de reparto.
- Si hay varios servicios sin reparto demostrable, se marca `reparto_pendiente`.
- Prórrogas, modificaciones, bajas y resoluciones se modelan como eventos relacionados y con efecto económico explícito.

La conciliación debe verificar que la suma de importes asignados no supera ni duplica el importe repartible de origen.

## 10. Exportación

El Excel se genera desde consultas versionadas, nunca editando el Master manual. Incluirá al menos:

- `Resumen_Cartera`;
- `Detalle_Provisiones`;
- `Entidades_Roles`;
- `Revision_Pendiente`;
- `Control_Calidad`;
- `Fuentes_Ejecucion`;
- `Diccionario_Datos`.

La agregación hacia códigos padre se calcula con `cartera_ancestors`. La vista plana conserva identificadores de provisión, parte, asignación y registro de origen.

## 11. Entorno local del primer PoC

La preparacion de Visual Studio Code, GitHub, Supabase remoto, Vercel y CI/CD se documenta paso a paso en [`PRODUCCION_Y_DESPLIEGUE.md`](PRODUCCION_Y_DESPLIEGUE.md). Esa guia tambien enumera las condiciones que deben cumplirse antes del primer despliegue, ya que la carpeta actual aun no contiene una aplicacion Next.js compilable.

### Entorno del prototipo

El sistema utilizará:

- Next.js y Node.js ejecutados localmente;
- un proyecto Supabase remoto para Postgres, Storage, Auth y pgvector;
- procesamiento TypeScript por lotes controlados desde la interfaz;
- llamadas externas a fuentes públicas y al proveedor de IA.

No se utilizará Supabase Local. Los datos persistentes y documentos auditables se guardarán en Supabase remoto. El ordenador deberá mantener la aplicación abierta mientras se procesa un lote.

### Ejecución de trabajos locales

Las operaciones largas se modelarán como una cola persistente en Postgres:

1. la web local crea una ejecución y sus primeros trabajos;
2. el proceso local reclama un lote mediante una operación atómica;
3. procesa una cantidad limitada de registros;
4. guarda resultados, errores y cursor en Supabase;
5. deja el siguiente trabajo preparado;
6. el usuario inicia el siguiente lote o el proceso local continúa hasta el límite configurado.

El contrato de la cola se mantendrá independiente del ejecutor para que, si el prototipo se despliega posteriormente, pueda trasladarse a funciones o jobs remotos sin modificar el modelo de datos o la interfaz.

### Secretos

- Las claves privadas se guardarán en `.env.local`, que deberá estar excluido de Git.
- La clave pública de Supabase podrá utilizarse en cliente bajo políticas RLS; las operaciones privilegiadas quedarán restringidas al servidor.
- Los buckets de documentos originales serán privados y se accederá a ellos mediante autorización o URLs firmadas.

## 12. ¿Tiene sentido empezar en Python y migrar después?

Es técnicamente posible, pero no es la opción recomendada para este proyecto.

Un prototipo Python podría desplegarse en un servicio remoto separado, pero introduciría un segundo runtime y un segundo flujo de despliegue. Migrarlo exigiría reescribir conectores, validaciones, jobs, integración con Supabase, procesamiento documental y exportación. Los datos almacenados y los esquemas SQL sí serían reutilizables; la mayor parte del código no lo sería automáticamente.

Solo tendría sentido empezar en Python si el objetivo fuese un experimento desechable de pocos días para resolver una incertidumbre concreta, por ejemplo comparar dos métodos de OCR. El pipeline principal debe comenzar en TypeScript para evitar una migración que no aporta valor.

## 13. Fases de implementación

### Fase 0. Contratos y aislamiento

- crear el monorepo y los tipos de dominio;
- definir migraciones y vocabularios;
- establecer el manifiesto de ejecución;
- añadir una salvaguarda que impida usar el Master manual como entrada.

### Fase 1. Acceso técnico

- probar esquema, paginación, filtros y límites de cada fuente;
- conservar muestras raw;
- documentar bloqueos y alternativas.

### Fase 2. Cartera y fuentes estructuradas

- extraer el catálogo oficial;
- implementar RAISC, convenios y RESES;
- conciliar filas y campos.

### Fase 3. Fuentes complejas

- implementar PSCP y BDNS;
- implementar paginación y eventos de e-Tauler/DOGC;
- descargar y enlazar documentos.

### Fase 4. Modelo canónico y calidad

- normalizar provisiones, partes y roles;
- etiquetar anomalías;
- exigir cero diferencias no explicadas.

### Fase 5. Matching piloto

- preparar índices y candidatos;
- integrar embeddings e IA;
- revisar la muestra de 400 casos;
- calibrar umbrales.

### Fase 6. Clasificación completa

- procesar por lotes reanudables;
- generar la cola de revisión;
- aplicar asignaciones y reparto auditables.

### Fase 7. Exportación y aceptación

- producir el Excel PoC;
- verificar trazabilidad, importes y jerarquía;
- congelar versión, manifiesto y métricas.

### Fase 8. Comparación independiente

Solo después de congelar el PoC se habilita un proceso separado que lee el Master manual y produce discrepancias. Esta comparación no corrige silenciosamente el resultado construido desde fuentes públicas.

## 14. Criterio de finalización

El PoC estará listo cuando pueda reproducirse desde fuentes públicas, satisfaga los criterios de precisión y cobertura de `PROJECT.md`, concilie filas e importes, conserve evidencia para todas las asignaciones y genere el Excel sin depender del Master manual.

# Mapeo de la financiación de la Cartera de Serveis Socials

## 1. Estado de este documento

Este documento recoge el análisis funcional y de datos inicial del proyecto. Describe qué se quiere construir, qué materiales existen, qué trabajo será necesario y las reglas metodológicas acordadas para el primer PoC.

No es todavía una especificación técnica cerrada ni implica que los datos actuales estén validados. Las afirmaciones se separan entre:

- **Confirmado:** aparece explícitamente en los documentos o se ha comprobado en los archivos.
- **Propuesta:** diseño recomendado para poder ejecutar el proyecto.
- **Pendiente:** decisión que requiere confirmación y no debe resolverse por suposición.

### 1.1 Decisiones confirmadas

- El PoC se construirá a partir de **fuentes públicas externas**, no a partir de los Excel preparados manualmente.
- El Excel manual `Master. Mapeo Cartera Serveis Socials.xlsx` será la referencia de comparación posterior, no una fuente de entrenamiento ni de generación del resultado.
- El alcance de subvenciones incluye **RAISC y BDNS**.
- RESES se obtendrá de su fuente pública y se utilizará para enriquecer entidades, servicios, establecimientos, tipologías y capacidad, siempre manteniendo su procedencia.
- La Cartera se obtendrá de fuentes públicas oficiales. Los PDF y el Master locales se usarán para contrastar la extracción, no para poblarla silenciosamente.
- La clasificación se hará al código más específico que permita la evidencia y los totales se agregarán hacia sus códigos padre.
- El periodo de concierto social y gestión delegada será 2024-2026 e incluirá los distintos tipos de acto publicados, diferenciando su efecto para evitar tratar modificaciones, prórrogas o bajas como nueva financiación.
- Una provisión se asociará por defecto a un único servicio de la Cartera. La división entre varios servicios será excepcional y requerirá evidencia explícita, como lotes, líneas, plazas o importes diferenciados.

## 2. Objetivo del proyecto

El Producto 1 consiste en mapear cómo se financia realmente la prestación de los servicios incluidos en la Cartera de Serveis Socials de Catalunya.

Para cada servicio se quiere identificar:

- el mecanismo público de financiación;
- las provisiones concretas asociadas;
- el importe observado;
- la Administración u órgano financiador;
- la entidad vinculada a la prestación;
- el documento y la fuente que justifican la asignación;
- el código y el nombre del servicio de la Cartera;
- los casos que podrían corresponder a servicios prestados en la práctica, pero no recogidos actualmente en la Cartera.

Los cuatro mecanismos incluidos son:

1. Concierto social o gestión delegada.
2. Subvención.
3. Convenio.
4. Contratación pública.

Los mecanismos no deben tratarse como una única categoría genérica de financiación. Cada uno tiene una fuente, una estructura administrativa y una semántica distinta.

## 3. Alcance de la Cartera

El Master utiliza únicamente la sección **1. Prestacions de serveis** del Annex I de la Cartera 2010-2011. Quedan fuera, por decisión ya documentada en el propio libro:

- sección 2: Prestacions econòmiques;
- sección 3: Prestacions tecnològiques.

La hoja de resumen contiene:

- 140 códigos numéricos procedentes de la sección 1;
- 33 códigos que actúan como agrupaciones jerárquicas;
- 107 códigos sin descendientes dentro del conjunto cargado;
- 2 filas ilustrativas con identificadores no oficiales: `FC-01` y `FNC-01`.

Los 140 códigos numéricos del Master coinciden en código y denominación con el PDF `Servicios Cartera.pdf`. El Decreto contiene, además, las fichas detalladas de cada prestación: definición, objeto, funciones, población destinataria, forma de prestación, perfiles profesionales, ratios, estándares y criterios de acceso. Esa información debe convertirse en la referencia semántica utilizada por el proceso de matching.

## 4. Fuentes disponibles

### 4.1 Contratación pública

Archivo: `Contrataciones. Consolidado 2024-2026.xlsx`.

Estado confirmado:

- 1.686 filas de datos y 27 columnas.
- Fuente indicada: PSCP.
- Incluye título, descripción, órgano, ámbito, CPV, importes, adjudicatarios, lugares, fechas y enlace de publicación.
- Hay 1.680 valores distintos en `Código del expediente`: cinco códigos aparecen en más de una Administración. Por tanto, el código del expediente no es una clave global suficiente.
- 236 filas contienen varios adjudicatarios en una sola celda.
- 458 filas contienen varios CPV.
- 258 filas contienen varios lugares de ejecución.
- Hay 14 filas sin importe de adjudicación, 3 importes iguales a cero y un valor máximo muy superior al resto que deberá validarse antes de agregar resultados.

Implicación: habrá que distinguir entre expediente, lote, adjudicación, proveedor y servicio de la Cartera. El enlace de publicación o una clave compuesta deben conservarse como identificador técnico.

### 4.2 Convenios

Archivo: `Convenios. Consolidado 2024-2026.xlsx`.

Estado confirmado:

- 615 filas de datos y 36 columnas.
- Los 615 números de convenio son únicos en el archivo.
- Incluye título, objeto, derechos y obligaciones, partes firmantes, aportaciones previstas, documento y anexos.
- 211 registros incluyen otros organismos firmantes.
- 284 registros contienen varios organismos locales firmantes.
- Todos los registros conservados tienen aportación prevista superior a cero.

Implicación: una parte firmante no equivale necesariamente a una entidad prestadora. Antes de llenar el campo de entidad habrá que establecer reglas para diferenciar financiador, entidad beneficiaria, entidad ejecutora y Administraciones que solo firman el convenio.

### 4.3 Subvenciones RAISC

Archivo: `Subvenciones. RAISC Consolidado 2024-2026.xlsx`.

Estado confirmado:

- Hoja `CCAA`: 11.264 filas.
- Hoja `Local`: 14.254 filas.
- Total: 25.518 concesiones y 42 columnas comunes.
- El campo `Clau` es único en las 25.518 filas y puede actuar como identificador de origen.
- Los códigos RAISC y BDNS se repiten porque una convocatoria tiene múltiples concesiones y beneficiarios.
- Existen 5.829 NIF distintos.
- Hay cuatro importes negativos en la hoja `CCAA`; deben interpretarse y etiquetarse antes de agregarlos.
- La cobertura de determinados campos difiere entre `CCAA` y `Local`, especialmente subfinalidad, aplicación presupuestaria y enlaces al diario oficial.

Implicación: las dos hojas pueden unirse en una misma tabla canónica, pero deben conservarse el nivel administrativo y los campos originales. Los importes negativos no deben eliminarse automáticamente: podrían ser reintegros, correcciones o revocaciones.

### 4.3.1 Subvenciones BDNS

Decisión confirmada:

- BDNS forma parte del alcance del PoC.
- La extracción se realizará desde la fuente pública oficial, utilizando su API o una descarga pública estructurada.
- La deduplicación entre RAISC y BDNS no se hará solo por título o beneficiario. Se conservarán los identificadores de ambas fuentes y se buscarán vínculos mediante código BDNS, convocatoria, órgano, beneficiario, fecha e importe.

Implicación: RAISC y BDNS deben modelarse como fuentes relacionadas pero no intercambiables. Un mismo hecho puede aparecer en ambas y la comparación debe distinguir cobertura adicional de duplicidad.

### 4.4 Concierto social y gestión delegada

Archivo disponible: `etauler-concert-filtrat-concert social.xml`.

Estado confirmado:

- Es un feed RSS con 100 elementos.
- El propio feed declara `totalResults = 12445` y `itemsPerPage = 100`.
- Solo 3 de los 100 elementos contienen la expresión `concert social`.
- Entre esos tres hay resoluciones de provisión de plazas y una resolución anticipada de una prestación ya asignada.
- El XML no representa una extracción completa y filtrada de conciertos sociales para 2024-2026.

Decisión confirmada: el periodo objetivo es 2024-2026 y se extraerán los distintos tipos de acto publicados. Cada acto se conservará como evento, pero solo los que creen o amplíen financiación o provisión computarán como importe nuevo. Prórrogas, modificaciones, emergencias, resoluciones anticipadas y bajas deberán vincularse con el expediente o provisión precedente y clasificarse según su efecto.

Implicación: este archivo sirve para comprender el formato del feed y preparar una prueba, pero no puede alimentar por sí solo el resultado final. Será necesario obtener todas las páginas pertinentes, aplicar filtros reproducibles y descargar o enlazar los documentos asociados.

### 4.5 Referencia de la Cartera

Archivos:

- `Servicios Cartera.pdf`: estructura y códigos de la Cartera.
- `DECRET 142...pdf`: fichas detalladas y marco normativo.
- `Master. Mapeo Cartera Serveis Socials.xlsx`: catálogo operativo y plantilla de salida.

Decisión confirmada: el catálogo utilizado por el PoC se reconstruirá desde fuentes públicas oficiales. Los tres archivos locales serán referencias para verificar códigos, nombres, jerarquía y contenido, pero no se usarán para completar automáticamente datos que falten en la extracción pública sin dejar constancia.

### 4.6 RESES

Decisión confirmada: RESES se extraerá de la fuente pública de Dades Obertes. Se conservarán los identificadores registrales y, cuando estén disponibles, la entidad titular, el servicio o establecimiento, la tipología, la dirección, el territorio y la capacidad.

RESES permitirá generar candidatos y comprobar coherencia entre entidad, establecimiento y tipo de servicio. No demostrará por sí solo que una provisión concreta financia ese servicio ni que la entidad registrada sea la prestadora efectiva en ese expediente.

### 4.7 Contexto funcional

Archivos:

- `Mapeo Taula. Brief para analisis IA.docx`.
- `UPSocial - Taula Tercer Sector - Chat inicial.pdf`.

Estos documentos fijan el objetivo, las fuentes, los filtros iniciales y los principios metodológicos. El PDF del chat contiene numerosas páginas vacías producidas por la exportación, pero conserva el planteamiento funcional y técnico relevante.

### 4.8 Registro inicial de fuentes públicas

Fuentes oficiales identificadas para iniciar el PoC:

- RAISC, Dades Obertes de Catalunya: `https://analisi.transparenciacatalunya.cat/d/s9xt-n979`.
- RESES, Dades Obertes de Catalunya: `https://analisi.transparenciacatalunya.cat/d/ivft-vegh`.
- Convenios, Dades Obertes de Catalunya: `https://analisi.transparenciacatalunya.cat/d/exh2-diuf`.
- Plataforma de Serveis de Contractació Pública: `https://contractaciopublica.cat/ca/inici` y el conjunto de datos abiertos enlazado por la propia plataforma.
- BDNS/Sistema Nacional de Publicidad de Subvenciones: `https://www.infosubvenciones.es/bdnstrans/GE/es/concesiones/consulta` y su documentación pública de API.
- Cartera de Serveis Socials: `https://dretssocials.gencat.cat/ca/serveis/cartera-de-serveis-socials/` y la versión oficial del Decreto en DOGC/Portal Jurídic.
- DOGC, datos abiertos y documentos estructurados: `https://dogc.gencat.cat/es/serveis/Dades_obertes/`.
- e-Tauler: feed y documentos públicos asociados a las búsquedas de concierto social y gestión delegada.

Antes de implementar cada conector se verificará el esquema, la paginación, los filtros temporales, los límites de consulta, la licencia y la fecha de actualización. El hecho de que una página sea pública no garantiza por sí solo que toda la extracción sea completa o estable.

## 5. Volumen inicial

Sin contar todavía una extracción completa de conciertos, los tres Excel de origen contienen:

- 25.518 concesiones RAISC;
- 1.686 registros de contratación;
- 615 convenios;
- **27.819 filas de origen en total**.

El número final de filas normalizadas será probablemente superior, porque algunos registros contienen:

- varios adjudicatarios;
- varios lotes;
- varios lugares o CPV;
- varios organismos firmantes;
- excepcionalmente, más de un servicio de la Cartera asociado a una misma provisión.

## 6. Libro Master actual

El archivo `Master. Mapeo Cartera Serveis Socials.xlsx` contiene cuatro hojas, una de ellas oculta:

1. `Léeme`.
2. `Tabla (resumen)`.
3. `Detalle_Provisiones`.
4. `Listas_Auxiliares` (oculta).

### 6.1 Tabla de resumen

La hoja `Tabla (resumen)` tiene una fila por servicio o candidato y agrega:

- importes y número de provisiones por mecanismo;
- importe total;
- mecanismo dominante;
- confianza general;
- distribución por departamento;
- número de entidades prestadoras;
- plazas o capacidad procedente de RESES.

Las fórmulas actuales agregan mediante coincidencia exacta del código asignado en `Detalle_Provisiones`. Por tanto, no realizan automáticamente una agregación jerárquica desde un subservicio hacia sus códigos padre.

### 6.2 Detalle de provisiones

La hoja `Detalle_Provisiones` tiene actualmente 12 columnas y 500 filas preparadas. Contiene dos filas ficticias que deberán eliminarse antes de cargar datos reales.

El tamaño actual es insuficiente para 27.819 registros de origen, incluso antes de desagregar registros multivalor o provisiones que correspondan a varios servicios.

Debe añadirse, como mínimo, el campo solicitado:

- `Nombre servicio Cartera`.

Además, para que la clasificación sea trazable y revisable, se propone añadir:

- identificador técnico único de la fila normalizada;
- título y descripción de la provisión;
- URL de la ficha y URL del documento analizado;
- Administración financiadora normalizada;
- entidad prestadora normalizada y NIF, cuando sea identificable;
- territorio;
- código Cartera asignado;
- nombre del servicio de la Cartera;
- estado del matching;
- confianza;
- método de asignación;
- evidencia textual;
- códigos alternativos considerados;
- indicador y estado de revisión humana;
- regla de reparto del importe;
- fecha de extracción o consulta;
- referencia a la fila y al archivo de origen.

Los campos específicos de cada fuente deben conservarse en tablas raw o staging; no deben descartarse al producir la vista unificada.

## 7. Modelo de datos propuesto

Se propone separar el sistema en cuatro capas.

### 7.1 Datos originales

Copias inmutables de cada descarga:

- RAISC;
- contratación PSCP;
- convenios;
- e-Tauler/DOGC;
- descarga pública BDNS;
- dataset público RESES;
- catálogo y fichas de la Cartera.

Los archivos originales no se modificarán.

Para garantizar la independencia del PoC, los Excel manuales existentes se mantendrán fuera del flujo de construcción. Solo se incorporarán en una fase posterior de evaluación, mediante una comparación reproducible.

### 7.2 Datos normalizados

Una tabla común de provisiones con una fila por unidad normalizada de origen. Debe conservar un vínculo inequívoco con la fila original.

Campos comunes propuestos:

- `provision_id`;
- `source_record_id`;
- `source_dataset`;
- `source_file`;
- `source_row`;
- `mechanism`;
- `title`;
- `description`;
- `funder_name`;
- `funder_level`;
- `provider_name`;
- `provider_nif`;
- `provision_date`;
- `amount`;
- `territory`;
- `record_url`;
- `document_url`;
- `retrieved_at`;
- `source_payload_hash`.

La normalización no debe borrar las diferencias entre mecanismos. Los campos propios de cada fuente permanecerán disponibles en tablas auxiliares o en una estructura de atributos de origen.

### 7.3 Referencia de Cartera

Una tabla de servicios con:

- código;
- nombre oficial;
- código padre;
- nivel jerárquico;
- indicador de agrupación o servicio final;
- ámbito o colectivo;
- descripción y definición;
- objeto;
- funciones;
- población destinataria;
- edad;
- forma de prestación;
- perfiles y ratios;
- garantía;
- sinónimos y abreviaturas de trabajo;
- vigencia o versión de la fuente.

### 7.4 Resultados de clasificación

Una tabla separada que permita varias asignaciones por provisión:

- `provision_id`;
- `cartera_code`;
- `cartera_name`;
- `match_method`;
- `confidence`;
- `evidence`;
- `alternative_codes`;
- `review_required`;
- `review_status`;
- `amount_allocated`;
- `allocation_method`.

Esta separación evita duplicar o perder el importe original cuando una provisión se relaciona con varios servicios.

Regla operativa confirmada:

- se asignará un único código específico por defecto;
- solo se crearán varias asignaciones cuando la fuente demuestre que existen varios servicios diferenciables;
- si la fuente aporta importes por lote o línea, se usarán esos importes;
- si demuestra varios servicios pero no permite repartir el importe, el caso quedará pendiente de revisión, sin repetir el total en cada código;
- si la evidencia no permite bajar a un servicio final, podrá mantenerse temporalmente el candidato de agrupación con revisión obligatoria, pero el objetivo final será el código más específico justificable.

## 8. Estrategia de matching propuesta

El matching no debe consistir en pedir a una IA que elija directamente entre 140 códigos sin preparación. Se propone un proceso escalonado.

### 8.1 Preparación documental

1. Obtener el texto disponible en cada fila de origen.
2. Descargar y extraer, cuando sea posible, la resolución, convenio, contrato, pliego, convocatoria o publicación asociada.
3. Conservar qué documento se leyó y qué fragmento se utilizó.
4. Detectar documentos inaccesibles o insuficientes y enviarlos a revisión.

### 8.2 Generación de candidatos

Aplicar, en este orden:

1. Código o denominación explícita de la Cartera en el documento.
2. Reglas y vocabulario especializado.
3. Correspondencias auxiliares de CPV y tipologías RESES.
4. Similitud semántica entre la provisión y las fichas de la Cartera.
5. Evaluación mediante modelo de lenguaje sobre un conjunto reducido de candidatos.

### 8.3 Principios de clasificación

- No asignar un código únicamente porque la entidad aparezca en RESES.
- No asignar un código únicamente por el colectivo atendido.
- RESES es evidencia auxiliar, no prueba suficiente.
- Una coincidencia de CPV ayuda a reducir candidatos, pero no demuestra por sí sola el servicio.
- Toda asignación debe conservar evidencia explicable.
- Debe ser posible devolver `sin correspondencia suficiente`.
- Los candidatos fuera de Cartera deben distinguir entre `FC` y `FNC`, siguiendo las definiciones ya presentes en el Master.
- Los casos ambiguos o con varios servicios deben pasar a revisión o aplicar una regla de reparto previamente aprobada.
- La población de nombres, descripciones, entidades y servicios se hará desde fuentes externas trazables; el Excel manual no se utilizará para favorecer una coincidencia.
- La clasificación principal se asignará al servicio más específico sustentado por la evidencia y los totales de los códigos padre se calcularán por agregación.
- Las señales procedentes de varias fuentes se conservarán por separado para que la comparación posterior permita saber qué fuente produjo cada dato.

## 9. Trabajo que se realizará

### Fase 0. Cierre metodológico

- Convertir las decisiones del apartado 12 en un diccionario de datos y reglas ejecutables.
- Verificar el acceso técnico, esquema, paginación y cobertura temporal de cada fuente pública.
- Congelar los filtros, umbrales y criterios de éxito aplicables a la primera ejecución del PoC.

### Fase 1. Extracción pública e ingesta reproducible

- Extraer de forma independiente RAISC, BDNS, PSCP, convenios, RESES, e-Tauler/DOGC y la Cartera desde sus fuentes públicas.
- Conservar la respuesta original, los parámetros, la fecha de consulta y, cuando exista, la versión del conjunto.
- Unir las particiones de una misma fuente conservando su procedencia.
- Construir claves técnicas estables.
- Identificar duplicados, multivalores, importes negativos, importes ausentes y valores extremos.
- Producir un informe de conciliación entre filas de origen y filas normalizadas.

### Fase 2. Catálogo enriquecido de la Cartera

- Reconstruir el catálogo operativo desde las fuentes públicas de la Cartera y su normativa.
- Incorporar la jerarquía y las fichas oficiales del Decreto.
- Añadir nombre, descripción, colectivo y demás campos semánticos necesarios para el matching.
- Preparar equivalencias auxiliares de CPV y RESES.
- Comparar después el catálogo externo con los 140 códigos del Master manual para detectar diferencias, sin utilizar este último para completar la extracción inicial.

### Fase 3. Piloto de matching

- Generar el conjunto candidato exclusivamente desde las fuentes públicas.
- Usar el Master manual como conjunto de referencia para la evaluación, nunca como entrada del matching.
- Seleccionar casos representativos de los distintos mecanismos, colectivos y niveles de dificultad.
- Probar reglas, similitud y clasificación con IA.
- Medir coincidencia de filas, códigos, nombres, entidades, importes, cobertura y tasa de revisión.
- Ajustar umbrales antes de procesar el universo completo.

### Fase 4. Clasificación completa

- Procesar las provisiones normalizadas.
- Guardar código, nombre, confianza, método y evidencia.
- Crear una cola de revisión humana.
- Gestionar provisiones con múltiples códigos sin duplicar indebidamente el importe.

### Fase 5. Generación del Master

- Crear un libro nuevo `Master. Mapeo Cartera Serveis Socials - PoC.xlsx`; el Master manual original no se sobrescribirá.
- Crear una `Detalle_Provisiones` dimensionada al volumen real.
- Añadir el texto del código de Cartera junto al código.
- Mantener trazabilidad hasta la fuente original.
- Recalcular la tabla resumen por mecanismo.
- Aplicar agregación jerárquica hacia códigos padre.
- Conciliar totales con cada fuente y documentar diferencias.

### Fase 6. Comparación independiente con el Master manual

- Comparar el PoC y el Excel manual por identificador de origen cuando exista y, en su defecto, mediante una clave de comparación explicable.
- Informar filas coincidentes, solo en PoC, solo en manual y casos ambiguos.
- Comparar código y nombre de Cartera, mecanismo, entidad, importe y evidencia.
- Calcular métricas de coincidencia exacta, coincidencia jerárquica, discrepancia y ausencia.
- Mantener una hoja de diferencias que permita revisar cada caso sin alterar ninguno de los dos resultados.

### Fase 7. Automatización y actualización

- Sustituir las descargas manuales por conectores reproducibles cuando exista API, Atom, RSS, XML u otra vía estable.
- Implementar paginación y filtrado completo para e-Tauler/DOGC.
- Mantener incorporadas BDNS y RESES como fuentes confirmadas.
- Registrar fecha de consulta, versión y parámetros de cada extracción.

## 10. Controles de calidad mínimos

- Todas las filas normalizadas deben conservar archivo, hoja y fila de origen.
- No debe perderse ninguna fila sin quedar explicado en el informe de conciliación.
- Las claves técnicas deben ser únicas.
- Los importes negativos, nulos y extremos deben quedar etiquetados.
- Las fechas deben pertenecer al periodo esperado o quedar marcadas.
- Los mecanismos deben usar un vocabulario controlado.
- Todos los códigos asignados deben existir en el catálogo o seguir el esquema provisional `FC`/`FNC`.
- Toda clasificación automática debe incluir evidencia y confianza.
- No se debe contar dos veces el importe total de una provisión multiclase.
- Los totales por fuente deben poder reconstruirse desde la tabla normalizada.
- Los ejemplos ficticios del Master deben excluirse de cualquier cálculo real.
- Debe poder demostrarse que ninguna celda del Master manual se utilizó para construir el resultado del PoC antes de la comparación.
- Toda diferencia entre la extracción pública y los archivos de referencia debe conservarse; no se corregirá silenciosamente para hacerlos coincidir.

## 11. Riesgos y limitaciones detectados

1. **Cobertura incompleta de conciertos.** El XML disponible no es una extracción completa.
2. **Dependencia de BDNS pública.** No existe un Excel BDNS local; habrá que gestionar disponibilidad, límites, paginación y cambios de la fuente pública.
3. **Dependencia de RESES pública.** La calidad, actualización y estabilidad del dataset condicionarán plazas, capacidad y evidencia auxiliar.
4. **Documentos por enlace.** Los Excel contienen enlaces a documentos fila a fila; todavía no se ha comprobado su accesibilidad masiva.
5. **Granularidad heterogénea.** Una fila puede representar una concesión, un convenio, un expediente con varios lotes o una resolución que modifica otra anterior.
6. **Entidad no siempre equivale a prestador.** Es especialmente relevante en convenios y subvenciones.
7. **Jerarquía de la Cartera.** El Master mezcla agrupaciones y servicios finales; las fórmulas actuales solo suman coincidencias exactas.
8. **Asignaciones múltiples excepcionales.** Solo se repartirán importes con evidencia explícita; los demás casos quedarán en revisión y pueden reducir temporalmente la cobertura.
9. **Indicadores no derivables.** El porcentaje de un servicio financiado públicamente, la cobertura total y las personas atendidas no pueden calcularse únicamente con las fuentes de financiación actuales.
10. **Master no dimensionado.** Las 500 filas de detalle no cubren el volumen real.
11. **Campos de auditoría insuficientes.** La plantilla no guarda todavía confianza, método, evidencia, revisión ni fecha de consulta.
12. **Fórmulas y portabilidad.** Las fórmulas con columnas completas funcionan en Excel, pero algunos motores alternativos no las evalúan correctamente; conviene convertir el detalle en una tabla estructurada y usar rangos controlados.

## 12. Decisiones metodológicas cerradas

### 12.1 Decisiones cerradas

- Subvenciones: se incluyen RAISC y BDNS mediante extracción pública.
- RESES: se extraerá de la fuente pública.
- Cartera: se reconstruirá desde fuentes públicas oficiales.
- Granularidad del código: se asignará al servicio más específico sustentado y se agregarán sus padres.
- Varios servicios de la Cartera: no es el caso normal. Solo se dividirá una provisión con evidencia clara; no se repetirá el importe total.
- Concierto social y gestión delegada: periodo 2024-2026, incluyendo los distintos actos y diferenciando su efecto económico.
- Comparación: el Master manual queda reservado para evaluar el PoC después de haberlo generado.

### 12.2 Unidad final de `Detalle_Provisiones`

Se utilizarán varias tablas relacionadas y `Detalle_Provisiones` será una vista plana de salida.

Unidades acordadas:

- **Provisión:** registro o acto administrativo original: concesión, convenio, expediente, adjudicación o resolución.
- **Parte de provisión:** unidad mínima identificable en la fuente, como lote, línea, beneficiario, centro o adjudicación. Solo tendrá importe propio cuando la fuente lo publique a ese nivel.
- **Asignación:** relación entre una parte de provisión y un servicio de la Cartera.
- **Entidad y rol:** relación separada entre la provisión o su parte y cada entidad implicada.

Cada fila de `Detalle_Provisiones` representará una asignación económica auditable: una parte de provisión, un código de Cartera y un `importe_asignado`. Si una provisión corresponde a un solo servicio, tendrá una única fila. Si existen varios servicios con importes diferenciados, habrá una fila por asignación y la suma será igual al importe de origen.

Los múltiples proveedores, firmantes o beneficiarios no multiplicarán filas ni importes en `Detalle_Provisiones`; se conservarán en la tabla de entidades y roles. Si hay varios servicios demostrados pero no existe base para repartir el importe, la provisión quedará como `reparto_pendiente` y no se crearán importes duplicados.

Campos de control obligatorios: `provision_id`, `provision_part_id`, `assignment_id`, `importe_origen`, `importe_asignado`, `estado_reparto`, `evita_doble_conteo` y `source_record_id`.

### 12.3 Entidad prestadora

No se convertirá automáticamente a un beneficiario, firmante o titular de RESES en entidad prestadora. Se conservarán roles separados: `financiador`, `convocante`, `beneficiario`, `adjudicatario`, `firmante`, `titular_RESES`, `gestor`, `prestador` y `otro`.

Reglas por mecanismo:

- **Contratación:** el adjudicatario podrá registrarse como prestador cuando el objeto o lote contratado corresponda al servicio clasificado.
- **Concierto social o gestión delegada:** será prestadora la entidad a la que la resolución atribuya expresamente la provisión, las plazas o la gestión.
- **Convenio:** una entidad solo será prestadora si el objeto, las obligaciones o los anexos le atribuyen la ejecución material del servicio.
- **Subvención:** la entidad seguirá siendo beneficiaria salvo que la convocatoria, la resolución, el proyecto financiado u otra fuente oficial demuestre que ejecuta el servicio.
- **RESES:** servirá para validar identidad, titularidad, tipología, centro y capacidad, pero no demostrará por sí solo quién ejecuta una provisión concreta.

Si no existe evidencia suficiente, `provider_name` y `provider_nif` quedarán vacíos, `provider_status` será `no_evidenciado` y la entidad seguirá apareciendo con el rol que sí conste en la fuente. No se rellenará el dato por semejanza de nombre ni por conocimiento general.

### 12.4 Definición de éxito del PoC

El PoC se considerará satisfactorio cuando cumpla simultáneamente estos criterios:

1. **Extracción:** se han agotado todas las páginas devueltas por cada fuente para los filtros acordados de 2024-2026, sin huecos no explicados respecto a los totales publicados por la propia fuente.
2. **Trazabilidad:** el 100 % de las filas del PoC conserva fuente, identificador, URL o documento, fecha de consulta y evidencia utilizada.
3. **Conciliación:** diferencia no explicada de 0 filas y 0 euros entre las descargas públicas conservadas y las tablas normalizadas. Nulos, negativos, anulaciones y correcciones pueden excluirse de determinados totales, pero deben permanecer identificados y reconciliados.
4. **Precisión automática exacta:** al menos 90 % de aciertos en el código específico de Cartera dentro de una muestra estratificada revisada manualmente.
5. **Precisión jerárquica:** al menos 95 % de aciertos cuando se considere correcta una coincidencia dentro de la misma rama de la Cartera.
6. **Cobertura automática:** al menos 70 % de las provisiones clasificables deben quedar asignadas automáticamente; como máximo 30 % pasarán a revisión por ambigüedad o evidencia insuficiente.
7. **Cobertura final del piloto:** después de la revisión, al menos 95 % de los casos de la muestra debe tener código específico o una conclusión explícita `sin_correspondencia_suficiente`. Ningún caso se forzará únicamente para alcanzar el porcentaje.
8. **Importes:** ninguna agregación puede duplicar el importe de origen. En asignaciones múltiples, la suma de `importe_asignado` debe ser igual al importe repartible de la provisión.
9. **Entidades:** el 100 % de las entidades mostradas como prestadoras debe tener evidencia directa y un rol trazable.
10. **Independencia:** debe poder reproducirse el PoC sin leer el Master manual. La comparación con el Master se ejecutará como un proceso posterior y separado.

La evaluación utilizará una muestra mínima de 400 casos, estratificada por mecanismo, nivel de confianza y dificultad. Si un mecanismo tiene menos de 100 casos en el piloto, se revisarán todos sus casos. Los desacuerdos entre PoC y Master manual no se considerarán automáticamente errores: se resolverán consultando la fuente pública y se clasificarán como `error_PoC`, `error_manual`, `cambio_fuente`, `diferencia_granularidad` o `no_resuelto`.

Una asignación automática podrá aceptarse sin revisión solo cuando incluya evidencia de fuente y cumpla una de estas condiciones:

- código o denominación oficial explícitos en el documento;
- regla determinista previamente validada;
- confianza calculada igual o superior a 0,90, diferencia mínima de 0,15 respecto al segundo candidato y ausencia de contradicciones entre fuentes.

El valor de confianza no sustituye a la evidencia. Los umbrales se mantendrán únicamente si la muestra revisada demuestra la precisión mínima del 90 %; en caso contrario se elevarán y aumentará la cola de revisión.

### 12.5 Stack técnico acordado

El PoC se implementará con un stack **TypeScript-first**, alineado con el entorno habitual de desarrollo del proyecto:

- **Nombre de la aplicación:** `Mapeig cartera de serveis.`

- **TypeScript** como lenguaje principal en frontend, backend y procesos de datos.
- **Next.js** para la aplicación web interna, sus rutas de servidor y la coordinación de operaciones.
- **Tailwind CSS** para la interfaz de seguimiento, revisión y consulta.
- **Supabase Postgres** como base de datos relacional y sistema central de trazabilidad.
- **Supabase Storage** para conservar snapshots originales, documentos descargados y exportaciones.
- **pgvector**, sobre Postgres, para la recuperación semántica de candidatos de la Cartera.
- **Procesos Node.js/TypeScript ejecutados desde la aplicación local** para extracciones, normalización, procesamiento documental, matching, conciliación y exportación. Se procesarán lotes pequeños y reanudables para poder controlar el trabajo desde la interfaz.
- **Proveedor de IA con salida estructurada** para embeddings y evaluación final de candidatos. La IA no sustituirá las reglas deterministas, la evidencia ni la revisión humana.

La primera versión será una **aplicación web local**, accesible desde el navegador mientras Next.js se ejecuta en el ordenador del usuario. No se requiere inicialmente GitHub, Vercel, automatización de despliegues ni una infraestructura de producción.

Supabase se mantiene como servicio remoto para Postgres, Storage y pgvector, evitando instalar una instancia local. Next.js y los procesos TypeScript se ejecutarán localmente y se comunicarán con Supabase remoto y con los servicios externos necesarios. La arquitectura deberá permitir un despliegue posterior sin reescribir el modelo de datos ni el matching.

Python no forma parte del stack principal. Solo se incorporará posteriormente como servicio auxiliar si una necesidad comprobada —por ejemplo, OCR o extracción documental especializada— no puede resolverse con calidad suficiente en TypeScript.

### 12.6 Interfaz de procesamiento y revisión

El PoC incluirá una interfaz web para procesar los registros de forma controlada, observar el resultado de cada etapa y evitar ejecuciones masivas no supervisadas durante la validación inicial.

La interfaz permitirá:

- importar o consultar registros de una fuente y ver su estado;
- filtrar y seleccionar filas concretas o un lote de tamaño limitado;
- iniciar, pausar lógicamente y reintentar trabajos;
- mostrar por fila el progreso de descarga, extracción documental, generación de candidatos y matching;
- consultar el código de Cartera propuesto, nombre, método, confianza, evidencia y alternativas;
- ver y clasificar errores sin perder la trazabilidad del registro;
- aprobar, corregir o rechazar una asignación;
- continuar con el siguiente lote solo cuando el usuario lo decida;
- consultar métricas acumuladas de precisión, cobertura y revisión.

La interfaz no procesará directamente las filas en el navegador. Creará trabajos remotos persistentes y reflejará su estado desde Supabase. Una recarga de página, un despliegue o un error temporal no deberá perder el progreso.

## 13. Primer PoC acordado

El primer entregable será la generación independiente de `Master. Mapeo Cartera Serveis Socials - PoC.xlsx` a partir de fuentes públicas externas. Deberá:

1. descargar o consultar las fuentes públicas con parámetros y fecha de extracción registrados;
2. conservar una copia inmutable de cada respuesta o archivo de origen;
3. producir un catálogo de Cartera extraído externamente y una tabla unificada de provisiones auditable;
4. enriquecer entidades y servicios con RESES y otras fuentes públicas, conservando los roles y la procedencia;
5. clasificar las provisiones contra la Cartera mostrando código, nombre, método, confianza y evidencia;
6. asignar por defecto un único servicio específico y enviar a revisión las divisiones no demostrables;
7. agregar los resultados a los códigos padre sin duplicar importes;
8. generar una cola de revisión y una hoja de control de calidad;
9. producir el Excel PoC sin abrir ni utilizar el contenido del Master manual durante su construcción;
10. ejecutar después una comparación separada con el Master manual y generar una hoja de discrepancias.

La comparación incluirá, como mínimo, cobertura de fuentes, filas ausentes o adicionales, coincidencia de identificadores, código y nombre de Cartera, mecanismo, entidad, importe, nivel jerárquico, confianza y evidencia. El PoC no se considerará validado por el mero hecho de aproximarse al Excel manual: cada diferencia deberá evaluarse contra la fuente pública correspondiente.

Solo después de validar este flujo conviene ampliar la automatización y construir una interfaz de consulta o revisión.

La guía técnica de ejecución se mantiene en `PIPELINE_IMPLEMENTATION_GUIDE.md`.

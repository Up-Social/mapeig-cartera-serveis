# Context del projecte

> Actualización 2026-09-12: el nuevo flujo normativo usa exclusivamente servicios hoja del catálogo oficial versionado, un servicio principal y cuatro categorías de análisis. Véase [NORMATIVE_MATCHING.md](NORMATIVE_MATCHING.md) para el contrato vigente y la instalación local. Las referencias al Master como destino del matching en el texto histórico siguiente ya no aplican al nuevo flujo.

## Producte

**Nom:** Mapeig cartera de serveis.

Prototip web intern per carregar registres de finançament públic, seleccionar-los i processar-los de manera controlada, proposar una correspondència amb la Cartera de serveis socials i revisar el resultat per pantalla. Es pot executar completament en local o desplegar la web amb un worker extern.

## Stack i entorns actuals

- TypeScript
- Next.js (App Router)
- React
- Tailwind CSS
- Supabase local sobre Docker per al desenvolupament i les proves
- Supabase remot per als entorns web desplegats
- Scripts d'ingesta en TypeScript executats amb Node.js

No s'utilitzarà Python com a part de l'aplicació ni del pipeline operatiu.

## Abast del PoC

1. Importar registres amb traçabilitat completa.
2. Consultar i filtrar els registres a la interfície.
3. Seleccionar files i executar-les per lots controlats.
4. Generar una proposta de matching amb codi, confiança i evidència.
5. Permetre aprovació, correcció, rebuig o evidència insuficient.
6. Mesurar qualitat abans d'escalar o desplegar.

## Fonts disponibles per provar la ingesta

- `Contrataciones. Consolidado 2024-2026.xlsx`
- `Convenios. Consolidado 2024-2026.xlsx`
- `Subvenciones. RAISC Consolidado 2024-2026.xlsx`

Aquests consolidats serveixen per validar la ingesta, la interfície i el pipeline. La versió definitiva del PoC haurà d'obtenir els registres de fonts públiques oficials i conservar-ne la URL i la data de captura.

## Tractament del Master

L'usuari ha autoritzat explícitament la importació de `Master. Mapeo Cartera Serveis Socials.xlsx`. Els seus serveis es desen a la taula separada `master_services`; no formen part de `source_records`. La importació no autoritza a utilitzar-lo per generar, entrenar, ajustar o validar silenciosament el matching. Aquest ús requerirà una decisió explícita separada.

## Principis de dades i matching

- La fila original és immutable i queda guardada a `source_payload`.
- Cada registre conserva fitxer, full i número de fila.
- Una reimportació és idempotent: actualitza el mateix registre, no el duplica.
- La proposta automàtica no substitueix la decisió humana.
- Confiança i evidència han de ser auditables.
- Les decisions de revisió es desen separadament de la proposta.

## Estat actual

La interfície principal s'organitza en sis entrades: Registres, Lots, Revisió, Incidències, Resultats i Referència. Resultats agrupa Aprovats, Descartats i Fora de cartera; Referència agrupa Catàleg i Entitats. L'explicació del procés és dins l'ajuda. **Incidències** concentra els casos amb evidència insuficient i els errors tècnics, mentre que els descartats disposen d'un apartat propi. Els lots automàtics contenen entre 1 i 50 casos únics i es reparteixen de manera equilibrada entre les tipologies disponibles. Un únic `process_run` persistent executa preparació, contrast i correspondència, i deixa els resultats correctes pendents de revisió humana.

El connector d'e-Tauler ha importat 305 actes únics del període 2024-2026 que contenen literalment l'expressió `concert social` al títol o a la descripció. La cerca exacta `gestió delegada social` no retorna anuncis. La fila importada representa l'acte administratiu i conserva la consulta, l'URL, les dates, el text original i una classificació preliminar del seu efecte. D'aquests actes, 157 són candidats automàtics a nova provisió o ampliació; la resta es conserva com a pròrroga, modificació, autorització de despesa, cessió, esmena, baixa, resolució anticipada o acte pendent de precisar. Els annexos poden generar posteriorment diverses provisions normalitzades.

Abans de seleccionar, el sistema exclou qualsevol registre que ja hagi format part d'un lot i també altres files amb la mateixa identitat normalitzada de matching. Això evita repetir una crida quan el mateix cas apareix duplicat dins d'un Excel o entre fonts. Les URL es dedupliquen a `source_documents` i es mostren com a evidència dins del registre corresponent.

El detall operatiu equivalent al full `Detalle_Provisiones` es construeix a Supabase a la taula `service_provisions`, només després de disposar d'un codi de Cartera revisat. El Master no és la font dels imports ni de les provisions. Aquesta taula alimenta les exportacions per lot, per selecció d'aprovats i, quan es configura `MASTER_EXCEL_PATH`, la còpia completa del Master.

Cada lot amb almenys una provisió vigent es pot exportar de manera independent a un llibre que només conté el full `Detalle_Provisiones`, amb 18 columnes: les 12 operatives, el nom del servei i cinc camps del desglossament (ID d'unitat, centre, període, tipus d'acte i referència de l'annex). L'exportació filtra exclusivament les provisions aprovades o corregides dels registres del lot i mai modifica el fitxer original. El desglossament actual de concerts encara no calcula l'efecte econòmic net entre actes relacionats; el cribratge de casuístiques del Sprint 1 és orientatiu i no crea imports automàtics.

L'extractor limita mida, temps, redireccions i destinacions privades; detecta HTML/PDF, extreu text i registra errors per document. El contracte del matching separa candidats, evidències i avaluació humana. `npm run matching:ready` bloqueja l'execució si falta OpenAI, model, evidència, treballs o un catàleg autoritzat. La revisió pot aprovar, corregir, rebutjar o declarar evidència insuficient, i només les decisions positives generen `service_provisions`.

Les fonts capturades a partir d'ara s'arxiven al bucket privat `cloud-documents` **per a totes les tipologies**: concerts, contractacions, convenis i subvencions. Un PDF, HTML o text descarregat es desa amb SHA-256 a `cases/{record_id}/documents/{document_id}/{sha}.{ext}` abans de marcar-lo com a processat. Si s'obre una font encara no arxivada, la ruta autenticada la descarrega de manera controlada, la desa al Storage del cas i verifica els bytes abans de servir-la; un canvi respecte del hash històric es comunica com a incidència. Si un registre genera unitats individuals, cada unitat rep la seva còpia a `cases/{record_id}/items/{unit_id}/documents/{document_id}/{sha}.{ext}`; la base de dades conserva les dues rutes i impedeix aprovar una línia si manca l'objecte de la unitat. Els llibres Excel d'una importació es conserven una vegada a `imports/{run_id}/{sha}.xlsx`, i cada fila importada té una instantània JSON sota `cases/{record_id}/imports/{run_id}/{sha}.json`, amb referència al llibre, full i número de fila. Les rutes no són públiques; l'aplicació serveix les còpies a través de rutes autenticades. Els registres històrics anteriors a aquesta migració poden no tenir encara bytes arxivats i necessiten recuperació o reprocessament verificat.

Quan un PDF no conté text digital, **Incidències** ofereix una recuperació completa amb OCR local. El worker converteix fins a 25 pàgines a imatges amb Poppler (`pdftoppm`), reconeix català i castellà amb Tesseract.js i conserva `tesseract-ocr` com a mètode d'extracció. Si obté text útil, regenera els fragments i continua automàticament amb contrast i matching fins a deixar el cas a **Revisió**; mai l'aprova. Qualsevol error d'OCR o de les fases posteriors manté el cas a **Incidències** amb el diagnòstic corresponent.

L'OCR automàtic està activat per defecte. L'apartat **Administració** permet activar-lo o desactivar-lo per als lots i processos automàtics nous. Cada lot conserva el valor vigent en el moment de crear-se, de manera que un canvi de configuració no altera una execució ja iniciada. Encara que estigui activat, l'OCR només s'executa quan l'extracció normal d'un PDF no obté text útil.

La mitjana del cost de processament amb IA per registre, separada entre concerts i altres tipologies, es consulta a **Administració**. No ocupa espai al llistat habitual de registres. És una estimació calculada amb l'ús mesurat, no una factura del proveïdor.

En el desplegament web, Vercel només crea tasques persistents a `worker_tasks`; no intenta mantenir processos Node.js després d'una petició. Un worker TypeScript extern reclama les tasques de manera atòmica i executa el procés complet contra Supabase remot. En desenvolupament local, el despatx és immediat per defecte i es pot forçar la cua amb `WORKER_EXECUTION_MODE=queue`.

Totes les pàgines, APIs i accions queden darrere d'una contrasenya compartida configurada amb `APP_ACCESS_PASSWORD`. La sessió signada caduca al cap de set dies i es conserva en una cookie `HttpOnly`; els intents fallits es limiten temporalment i les escriptures validen l'origen. Si falta la variable, l'aplicació falla de manera tancada i només mostra la pantalla d'accés. Cada lot nou rep també un pressupost preventiu de proveïdor, amb cost reservat i confirmat visible al detall.

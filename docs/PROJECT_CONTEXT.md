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

Cada lot amb almenys una provisió vigent es pot exportar de manera independent a un llibre que només conté el full `Detalle_Provisiones`, amb 18 columnes: les 12 operatives, el nom del servei i cinc camps del desglossament (ID d'unitat, centre, període, tipus d'acte i referència de l'annex). L'exportació filtra exclusivament les provisions aprovades o corregides dels registres del lot i mai modifica el fitxer original. La foto i els moviments de concerts es calculen amb una projecció separada per període i finançador, només amb línies, vincles i interpretacions econòmiques revisades. Els actes pendents bloquegen el saldo definitiu; una etiqueta de casuística no acredita per si sola un import.

L'extractor limita mida, temps, redireccions i destinacions privades; detecta HTML/PDF, extreu text i registra errors per document. El contracte del matching separa candidats, evidències i avaluació humana. `npm run matching:ready` bloqueja l'execució si falta OpenAI, model, evidència, treballs o un catàleg autoritzat. La revisió pot aprovar, corregir, rebutjar o declarar evidència insuficient, i només les decisions positives generen `service_provisions`.

Les fonts capturades a partir d'ara s'arxiven al bucket privat `cloud-documents` **per a totes les tipologies**: concerts, contractacions, convenis i subvencions. Un PDF, HTML o text descarregat es desa amb SHA-256 a `cases/{record_id}/documents/{document_id}/{sha}.{ext}` abans de marcar-lo com a processat. Si s'obre una font encara no arxivada, la ruta autenticada la descarrega de manera controlada, la desa al Storage del cas i verifica els bytes abans de servir-la; un canvi respecte del hash històric es comunica com a incidència. Si un registre genera unitats individuals, cada unitat rep la seva còpia a `cases/{record_id}/items/{unit_id}/documents/{document_id}/{sha}.{ext}`; la base de dades conserva les dues rutes i impedeix aprovar una línia si manca l'objecte de la unitat. Els llibres Excel d'una importació es conserven una vegada a `imports/{run_id}/{sha}.xlsx`, i cada fila importada té una instantània JSON sota `cases/{record_id}/imports/{run_id}/{sha}.json`, amb referència al llibre, full i número de fila. Les rutes no són públiques; l'aplicació serveix les còpies a través de rutes autenticades. Els registres històrics anteriors a aquesta migració poden no tenir encara bytes arxivats i necessiten recuperació o reprocessament verificat.

Quan un PDF no conté text digital útil, el worker intenta primer `pdftotext -layout` i fa OCR de les pàgines necessàries amb Poppler (`pdftoppm` a 300 ppp) i el programa Tesseract amb els models de català i castellà. El límit és de 25 pàgines OCR per document; el mètode queda registrat com `pdf-ocr-markdown-v2` i la cobertura indica les pàgines, el motor, els idiomes i la resolució. Si obté text útil, regenera els fragments i continua amb contrast i matching; mai no aprova el resultat. Un document il·legible o incomplet queda com a incidència. El reprocessament complet torna a cercar les fonts i executa totes les fases; el reintent d'una sola fase es mostra per separat.

L'OCR automàtic està activat per defecte. L'apartat **Administració** permet activar-lo o desactivar-lo per als lots i processos automàtics nous. Cada lot conserva el valor vigent en el moment de crear-se, de manera que un canvi de configuració no altera una execució ja iniciada. Encara que estigui activat, l'OCR només s'executa quan l'extracció normal d'un PDF no obté text útil.

La despesa calculada de processament amb IA es consulta a **Costos**, una entrada independent situada sota Administració al menú lateral: total acumulat, mitjana per registre amb ús mesurat, desglossament entre concerts i altres tipologies, nombre de crides, execucions i registres revisats. Inclou les respostes antigues amb tokens verificables i compta una sola vegada les crides copiades en recuperacions. La vista es refresca automàticament mentre està oberta. Les xifres es mostren en euros amb la data del canvi de referència del BCE; si aquest canvi no està disponible, s'identifica clarament el cost original en USD. La reserva preventiva pendent es mostra separada del cost processat. És un càlcul basat en l'ús i la tarifa configurada, no una factura del proveïdor, i no inclou revisió humana, OCR local ni infraestructura. El detall de cada lot mostra també el cost processat i la reserva pendent amb la mateixa conversió. El menú lateral mostra recomptes de tots els registres importats, lots (sense operacions individuals), casos amb revisió o incidència i casos amb un resultat final.

**Registres importats** mostra sempre totes les files de `source_records`, incloses les que ja tenen resultats o revisions. La vista de lectura `imported_record_processing_overview` té una sola fila per registre i separa l'estat d'execució (pendent sense cap intent, en curs, processat o error) de l'estat de revisió humana. Els filtres de processament, revisió i origen de l'execució s'apliquen a la base de dades abans de paginar. Es compten els intents per registre i se'n desglossen els fets en lot, individualment i amb altres fluxos històrics; una reanàlisi pot aparèixer en més d'una categoria. Els totals superiors provenen de la mateixa vista, de manera que «Processats» no es confon amb «Aprovats».

En el desplegament web, Vercel Workflow reprèn tasques persistents a `worker_tasks` amb leases i checkpoints. La petició engega el workflow i no manté processos Node.js locals en segon pla. En desenvolupament local, el despatx és immediat per defecte i es pot forçar la cua amb `WORKER_EXECUTION_MODE=queue`.

Totes les pàgines, APIs i accions queden darrere d'una contrasenya compartida configurada amb `APP_ACCESS_PASSWORD`. La sessió signada caduca al cap de set dies i es conserva en una cookie `HttpOnly`; els intents fallits es limiten temporalment i les escriptures validen l'origen. Si falta la variable, l'aplicació falla de manera tancada i només mostra la pantalla d'accés. Cada lot nou rep també un pressupost preventiu de proveïdor, amb cost reservat i confirmat visible al detall.


## Recuperació documental i criteris de concerts (15/10/2026)

El pas 2 és **Anàlisi de la resolució** en concerts, també en incidències i lots. Els diagnòstics distingeixen font no substantiva, fet absent, cita no verificable, incompatibilitat, línia pendent i conciliació econòmica. Els resultats antics que no van registrar la causa concreta s'identifiquen com a històrics: desplegar no els reescriu.

Els annexos de programes amb capçalera NIF/Disposició/RESES/Tipologia es llegeixen per columnes detectades, amb noms multilínia i continuacions. Una esmena que reprodueix expressament l'annex final no suma també les taules comparatives. Es conserven les files documentals, els imports DA, els costos de referència emprats com a pesos i el repartiment exacte en cèntims. La cobertura i el total es concilien abans de presentar el conjunt com a complet. Altres formats d'annex conserven els extractors específics i els seus controls; un format desconegut no es dona per resolt.

`concert_line_observations` conserva cada canvi d'observació. Les línies existents mantenen l'ID quan els identificadors i la prova documental són inequívocs. Una línia revisada o preparada a mà no es sobreescriu: queda una proposta pendent. Repetir la mateixa versió és idempotent i també recupera un arxivament interromput. Els codis agrupadors s'accepten només en concerts acreditats documentalment, amb **Nivell específic no indicat**; no es relaxa el catàleg de les altres tipologies.

La validació conjunta dels annexos conciliats evita aprovar tot un document sota un únic servei. Les pròrrogues/esmenes aprovades són moviments, no noves provisions heretades. La foto agrupa per NIF vigent × servei × territori, mantenint períodes i finançadors separats; una cessió revisada canvia el titular de la foto sense alterar els actors dels moviments històrics. Les còpies documentals amb identitat de contingut acreditada no dupliquen imports. L'horitzó continua des de 2024 i els originals desconeguts bloquegen el saldo.

La fitxa incorpora un visor PDF.js autenticat, amb pàgines i zoom, servit per l'aplicació. El text extret queda desplegable i no es presenta com si fos un visor. L'OCR opcional de pàgines concretes utilitza Tesseract cat+spa a 400 ppp i conserva la lectura de les altres pàgines; no canvia automàticament el model d'IA. El reprocesament ordinari manté els 300 ppp i la configuració vigent.

En les altres tipologies, la comparació mostra camps d'origen i document, coincidències, absències i discrepàncies. L'Excel té prioritat en els valors equivalents informats: entitat, import (inclòs zero), mecanisme i, on existeix el camp equivalent, NIF, data de concessió/signatura i òrgan. La data de publicació no substitueix la d'adjudicació, ni el tipus de beneficiari identifica els usuaris finals. L'edició manual ampliada queda fora d'aquest canvi.

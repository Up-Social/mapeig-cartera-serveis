# Guia de la interfície

## Accés

La web demana la contrasenya compartida configurada amb `APP_ACCESS_PASSWORD`. La sessió dura set dies en el mateix navegador. **Tancar sessió** elimina la cookie d'accés immediatament. Si falta la variable al servidor, l'aplicació només mostra l'avís de configuració i no permet entrar.

## Mapa de l'aplicació

En pantalles d'escriptori, la navegació principal es manté visible en una barra lateral esquerra. El control **Plegar menú** la redueix a una banda d'icones per recuperar amplada de treball; els accessos, l'estat actiu i els comptadors continuen disponibles. En mòbil s'obre com un panell lateral. **Revisió**, **Incidències** i **Aprovats** mostren un comptador actualitzat tant al menú com a la capçalera de la pantalla corresponent.

- **Registres**: consulta de tots els registres importats, amb filtres per tipologia i estat. La font concreta es mostra dins de cada registre.
- **Lots**: creació automàtica d'1 a 50 registres, progrés persistent i execució completa fins a revisió.
- **Revisió**: validació humana consecutiva dels candidats generats.
- **Incidències**: seguiment dels casos rebutjats, amb evidència insuficient o amb errors tècnics, amb el motiu i l'acció de resolució.
- **Aprovats**: consulta i exportació de les provisions vigents després d'una decisió positiva.
- **Catàleg**: consulta dels serveis importats i de les provisions aprovades que hi estan vinculades.
- **Entitats**: consulta d'entitats normalitzades, serveis RESES, mencions i relacions amb el catàleg.
- **Procés**: resum documental del pipeline, el flux d'aprovacions entre pantalles i el registre de fonts.

## Resum del procés

El pipeline segueix sis passos: captació, preparació documental, contrast de dades, proposta de correspondència, revisió humana i resultat. **Registres** permet el procés individual i **Lots** l'execució conjunta; tots dos envien els resultats correctes a **Revisió** i els errors a **Incidències**. A **Revisió**, aprovar o corregir crea una provisió a **Aprovats**; rebutjar o declarar evidència insuficient exigeix un motiu i envia el cas a **Incidències**.

La pantalla **Procés** manté aquest flux visible juntament amb les fonts PSCP, Registre de Convenis, RAISC i e-Tauler. RESES es documenta com a font auxiliar i BDNS com a connexió pendent.

## Crear i processar un lot automàtic

1. Obre **Lots**.
2. Escull entre 1 i 50 registres.
3. Prem **Crear i processar lot**. La selecció és atòmica i reparteix els casos entre les tipologies disponibles.
4. El worker executa preparació, contrast i matching sense confirmacions intermèdies.
5. Consulta el progrés per fase i obre **Revisió** quan aparegui **Lot preparat per revisar**.

La mostra només utilitza registres pendents. Exclou qualsevol cas que ja hagi format part d'un lot i les files equivalents detectades mitjançant la identitat normalitzada. Així, una duplicació als Excel no provoca un segon matching del mateix cas.

## Progrés automàtic

1. La pantalla s'actualitza automàticament mentre el sistema cerca URLs, descarrega documents i crea fragments.
2. Els registres preparats passen al contrast de dades i després al matching; un error individual no atura els altres.
3. Cada registre acaba amb un dels estats següents:
   - **Llest**: disposa d'evidència i pot anar a matching.
   - **Sense font documental**: la fila no conté cap URL útil.
   - **Format no compatible**: requereix OCR o un extractor addicional.
   - **Error**: no s'ha pogut descarregar o processar la font.

Els documents no apareixen com una font independent: formen part del detall del registre del dataset corresponent.

## Processar un registre individual

Des de **Registres**, selecciona qualsevol fila i utilitza el bloc **Procés del registre**:

1. Prem **Processar**.
2. El sistema crea un lot individual i executa automàticament preparació, contrast i matching.
3. El panell mostra la fase actual i es manté obert sense recarregar la pàgina.
4. En acabar, el registre queda **Pendent de revisió**.

Els processos en segon pla actualitzen automàticament el panell. Preparar o contrastar un registre per inspeccionar-lo no l'exclou dels futurs lots; queda exclòs únicament després d'entrar realment en matching.

## Revisar i validar

1. Obre **Revisió** des de la fitxa del lot.
2. Selecciona una fila de la cua.
3. Comprova totes les dades originals, l'evidència documental, els tres candidats i la fitxa completa del servei.
4. Pots:
   - aprovar un candidat;
   - buscar i escollir qualsevol servei del catàleg;
   - rebutjar el matching, indicant-ne obligatòriament el motiu;
   - indicar que l'evidència és insuficient i explicar què falta.
5. Després de decidir, la interfície avança al registre següent.

Una aprovació o correcció crea una fila a `service_provisions`. Un rebuig o una evidència insuficient no en crea cap. Si modifiques una decisió, el sistema demana confirmació, conserva l'historial i sincronitza la provisió vigent.

## Gestionar incidències

La pantalla **Incidències** agrupa els registres que no han acabat en una provisió aprovada. Distingix entre decisions humanes negatives, problemes de font documental i errors de preparació, contrast o correspondència. Els comptadors i filtres permeten localitzar-los per problema, tipologia, lot o text.

La incorporació és automàtica tant si el registre s'ha processat individualment des de **Registres** com si forma part d'un **Lot**. La detecció comprova l'últim error tècnic i l'última decisió humana, a més de l'estat general del registre, per evitar que una desincronització entre fases amagui el cas.

Cada cas es pot desplegar per veure el motiu, la fase, la data, els candidats i els documents oficials. Els rebutjos i casos amb evidència insuficient tornen a **Revisió** per rectificar la decisió; els errors tècnics ofereixen un reintent de la fase afectada. L'historial de decisions es conserva.

### Què significa cada bloc del detall

- **Dades originals de l'Excel**: informació importada de la fila d'origen. Serveix de context i no es considera contrast extern. Les fórmules no es mostren ni s'envien a OpenAI.
- **Dades contrastades amb fonts oficials**: camps extrets dels documents descarregats (conveni, contractació, convocatòria o base reguladora). Cada extracció mostra confiança i els fragments que la sustenten.
- **Documents oficials**: URL, estat d'extracció i qualitat de la font utilitzada. Si no hi ha document preparat, el cas no es pot enriquir ni enviar a matching.
- **Fitxa del servei candidat**: només mostra les dades canòniques del catàleg de Cartera. Les fórmules del full resum del Master no són atributs del servei i no apareixen aquí.

El matching combina els fragments de la font oficial amb el catàleg per proposar el servei, però la decisió final continua sent humana. Que una dada aparegui a l'Excel no implica que estigui contrastada; la interfície manté aquesta diferència visible.

## Exportar el detall d'un lot

Quan un lot té almenys una provisió aprovada o corregida, al seu costat apareix el botó **Descarregar Excel**. Cada lot genera un llibre independent amb l'estat vigent en el moment de la descàrrega:

- només conté el full `Detalle_Provisiones`;
- conté les 12 columnes operatives del Master i afegeix `Nombre servicio Cartera`;
- només inclou les provisions aprovades o corregides d'aquell lot;
- no barreja resultats d'altres lots;
- les dates, imports i hipervincles mantenen el tipus correcte;
- el Master original no es modifica.

Si el lot encara no té cap provisió positiva, l'exportació no s'activa. El nom incorpora el número humà del lot i la data d'exportació.

## Exportar provisions aprovades

La pantalla **Aprovats** permet seleccionar les provisions visibles o totes les que compleixen els filtres i exportar entre 1 i 5.000 files. Abans de generar el llibre, el servidor torna a comprovar que totes continuïn vigents, que el registre estigui completat i que l'última decisió sigui una aprovació o correcció.

També existeix una exportació completa sobre una còpia del Master quan el servidor disposa de `MASTER_EXCEL_PATH`. Cap de les tres modalitats modifica el fitxer original.

## Resolució de problemes

- **No es pot crear el lot**: no queden prou identitats pendents i no processades per a la mida indicada.
- **Sense font documental**: substitueix la fila o continua amb els registres llestos.
- **Format no compatible**: el document necessita OCR; no s'envia a OpenAI.
- **El matching no comença**: comprova la clau, el model, l'autorització del catàleg i que el lot tingui registres llestos.
- **No es pot exportar un lot**: encara queden casos per revisar o falta `MASTER_EXCEL_PATH` a `.env.local`.

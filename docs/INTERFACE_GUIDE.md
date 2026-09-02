# Guia de la interfície

## Mapa de l'aplicació

- **Registres**: consulta dels 28.124 registres importats, amb filtres per tipologia i estat. La font concreta es mostra dins de cada registre.
- **Lots**: creació automàtica d'1 a 50 registres, progrés persistent i execució completa fins a revisió.
- **Revisió**: validació humana consecutiva dels candidats generats.
- **Catàleg**: consulta dels 142 serveis i de les provisions aprovades que hi estan vinculades.
- **Procés**: explicació completa de les tipologies, les fonts internes, l'extracció, el matching, la revisió i l'exportació.

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
   - rebutjar el matching;
   - indicar que l'evidència és insuficient.
5. Després de decidir, la interfície avança al registre següent.

Una aprovació o correcció crea una fila a `service_provisions`. Un rebuig o una evidència insuficient no en crea cap. Si modifiques una decisió, el sistema demana confirmació, conserva l'historial i sincronitza la provisió vigent.

### Què significa cada bloc del detall

- **Dades originals de l'Excel**: informació importada de la fila d'origen. Serveix de context i no es considera contrast extern. Les fórmules no es mostren ni s'envien a OpenAI.
- **Dades contrastades amb fonts oficials**: camps extrets dels documents descarregats (conveni, contractació, convocatòria o base reguladora). Cada extracció mostra confiança i els fragments que la sustenten.
- **Documents oficials**: URL, estat d'extracció i qualitat de la font utilitzada. Si no hi ha document preparat, el cas no es pot enriquir ni enviar a matching.
- **Fitxa del servei candidat**: només mostra les dades canòniques del catàleg de Cartera. Les fórmules del full resum del Master no són atributs del servei i no apareixen aquí.

El matching combina els fragments de la font oficial amb el catàleg per proposar el servei, però la decisió final continua sent humana. Que una dada aparegui a l'Excel no implica que estigui contrastada; la interfície manté aquesta diferència visible.

## Exportar el detall d'un lot

Quan tots els casos d'un lot han estat revisats, al seu costat apareix el botó **Descarregar detall**. Cada lot genera un Excel independent:

- només conté el full `Detalle_Provisiones`;
- conserva exactament les 12 columnes i el format de la pestanya del Master;
- només inclou les provisions aprovades o corregides d'aquell lot;
- no barreja resultats d'altres lots;
- les dates, imports i hipervincles mantenen el tipus correcte;
- el Master original no es modifica.

Si tots els casos han estat rebutjats o marcats com a evidència insuficient, el fitxer es pot generar amb la capçalera i cap fila de provisió. El nom incorpora l'identificador curt del lot i la data d'exportació.

## Resolució de problemes

- **No es pot crear el lot**: no queden prou identitats pendents i no processades per a la mida indicada.
- **Sense font documental**: substitueix la fila o continua amb els registres llestos.
- **Format no compatible**: el document necessita OCR; no s'envia a OpenAI.
- **El matching no comença**: comprova la clau, el model, l'autorització del catàleg i que el lot tingui registres llestos.
- **No es pot exportar un lot**: encara queden casos per revisar o falta `MASTER_EXCEL_PATH` a `.env.local`.

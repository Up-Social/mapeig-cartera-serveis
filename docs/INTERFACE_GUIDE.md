# Guia de la interfície

## Mapa de l'aplicació

- **Registres**: consulta dels 28.124 registres importats, amb filtres per tipologia i estat. La font concreta es mostra dins de cada registre.
- **Lots**: selecció equilibrada, preparació d'evidència, confirmació de cost i execució del matching.
- **Revisió**: validació humana consecutiva dels candidats generats.
- **Catàleg**: consulta dels 142 serveis i de les provisions aprovades que hi estan vinculades.
- **Procés**: explicació completa de les tipologies, les fonts internes, l'extracció, el matching, la revisió i l'exportació.

## Crear un lot equilibrat de 4

1. Obre **Lots**.
2. Prem **Generar mostra de 4**. El sistema intenta seleccionar un cas de cada tipologia disponible.
3. Les quatre tipologies ja estan disponibles: contractació, conveni, subvenció i concert social/gestió delegada. La distribució normal és `1 + 1 + 1 + 1` mentre quedin casos pendents de totes quatre.
4. Revisa els casos. Pots **Substituir** un cas per un altre de la mateixa tipologia o **Treure** una fila i tornar-la a afegir.
5. Quan hi hagi 4 casos, prem **Crear lot**.

La mostra només utilitza registres pendents. Exclou qualsevol cas que ja hagi format part d'un lot i les files equivalents detectades mitjançant la identitat normalitzada. Així, una duplicació als Excel no provoca un segon matching del mateix cas.

## Preparar l'evidència

1. Dins la fitxa del lot, prem **Preparar evidència**.
2. La pantalla s'actualitza automàticament mentre el sistema cerca URLs, descarrega documents i crea fragments.
3. Cada registre acaba amb un dels estats següents:
   - **Llest**: disposa d'evidència i pot anar a matching.
   - **Sense font documental**: la fila no conté cap URL útil.
   - **Format no compatible**: requereix OCR o un extractor addicional.
   - **Error**: no s'ha pogut descarregar o processar la font.

Els documents no apareixen com una font independent: formen part del detall del registre del dataset corresponent.

## Consultar un registre sense fer matching

Des de **Registres**, selecciona qualsevol fila i utilitza el bloc **Procés del registre**:

1. **Preparar fonts** descobreix les URL del registre, descarrega els documents, extreu el text i crea fragments. Aquesta etapa és local i no utilitza OpenAI.
2. **Contrastar dades** envia només el context necessari i els fragments oficials a OpenAI. Extreu camps estructurats i evidències, però no rep el catàleg ni proposa cap servei.
3. Les dades contrastades apareixen immediatament en un bloc verd dins del registre, encara que no s'hagi executat matching.
4. **Fer matching** només s'activa quan les dues etapes anteriors han acabat. Reutilitza l'enriquiment existent i no torna a pagar-ne l'extracció.

Els processos en segon pla actualitzen automàticament el panell. Preparar o contrastar un registre per inspeccionar-lo no l'exclou dels futurs lots; queda exclòs únicament després d'entrar realment en matching.

## Confirmar i executar el matching

Quan acaba la preparació, la fitxa mostra quants registres estan llestos, les crides previstes, els tokens aproximats i el cost màxim estimat. Només els registres **Llestos** s'envien a OpenAI.

Prem **Confirmar i fer matching**. El procés continua en segon pla i la pàgina mostra el progrés. Els errors d'una fila no aturen la resta del lot.

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

- **El lot no arriba a 4**: no queden quatre identitats pendents i no processades entre les tipologies disponibles.
- **Sense font documental**: substitueix la fila o continua amb els registres llestos.
- **Format no compatible**: el document necessita OCR; no s'envia a OpenAI.
- **El matching no comença**: comprova la clau, el model, l'autorització del catàleg i que el lot tingui registres llestos.
- **No es pot exportar un lot**: encara queden casos per revisar o falta `MASTER_EXCEL_PATH` a `.env.local`.

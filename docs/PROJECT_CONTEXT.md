# Context del projecte

## Producte

**Nom:** Mapeig cartera de serveis.

Prototip web local per carregar registres de finançament públic, seleccionar-los i processar-los de manera controlada, proposar una correspondència amb la Cartera de serveis socials i revisar el resultat per pantalla.

## Stack acordat

- TypeScript
- Next.js (App Router)
- React
- Tailwind CSS
- Supabase local sobre Docker (Postgres, API i Studio)
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

La interfície s'organitza en Registres, Lots, Revisió, Catàleg i Procés. Els lots guiats parteixen d'una mostra previsualitzable de 4 casos únics, un per cada tipologia de finançament disponible. Si una tipologia està esgotada o encara no té connector, la plaça restant es completa amb una altra tipologia. Les fonts o datasets queden subordinats a les tipologies: contractació, conveni, subvenció i concert social/gestió delegada.

El connector d'e-Tauler ha importat 305 actes únics del període 2024-2026 que contenen literalment l'expressió `concert social` al títol o a la descripció. La cerca exacta `gestió delegada social` no retorna anuncis. La fila importada representa l'acte administratiu i conserva la consulta, l'URL, les dates, el text original i una classificació preliminar del seu efecte. D'aquests actes, 157 són candidats automàtics a nova provisió o ampliació; la resta es conserva com a pròrroga, modificació, autorització de despesa, cessió, esmena, baixa, resolució anticipada o acte pendent de precisar. Els annexos poden generar posteriorment diverses provisions normalitzades.

Abans de seleccionar, el sistema exclou qualsevol registre que ja hagi format part d'un lot i també altres files amb la mateixa identitat normalitzada de matching. Això evita repetir una crida quan el mateix cas apareix duplicat dins d'un Excel o entre fonts. Les URL es dedupliquen a `source_documents` i es mostren com a evidència dins del registre corresponent.

El detall operatiu equivalent al full `Detalle_Provisiones` es construeix a Supabase a la taula `service_provisions`, només després de disposar d'un codi de Cartera revisat. El Master no és la font dels imports ni de les provisions. En una fase posterior, aquesta taula alimentarà l'exportació cap a una còpia de l'Excel.

Cada lot finalitzat es pot exportar de manera independent a un llibre que només conté el full `Detalle_Provisiones`, amb les 12 columnes i els estils del Master. L'exportació filtra exclusivament les provisions vigents dels registres del lot i mai modifica el fitxer original.

L'extractor limita mida, temps, redireccions i destinacions privades; detecta HTML/PDF, extreu text i registra errors per document. El contracte del matching separa candidats, evidències i avaluació humana. `npm run matching:ready` bloqueja l'execució si falta OpenAI, model, evidència, treballs o un catàleg autoritzat. La revisió pot aprovar, corregir, rebutjar o declarar evidència insuficient, i només les decisions positives generen `service_provisions`.

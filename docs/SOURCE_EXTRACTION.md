# Extracció de fonts externes

L'script `scripts/fetch-source-sample.ts` descarrega una mostra controlada de les URL registrades a `source_documents`.

```bash
npm run sources:sample -- --limit 20
```

Controls aplicats:

- només HTTP/HTTPS i sense credencials a la URL;
- bloqueig de destinacions de xarxa privada;
- màxim de cinc redireccions;
- 20 segons de descàrrega i 25 segons totals per document;
- límit de 10 MB per resposta;
- text limitat a 200.000 caràcters;
- hash SHA-256 del contingut;
- extracció HTML/text integrada i PDF mitjançant `pdftotext`;
- errors i formats no compatibles registrats sense aturar el lot.

La primera mostra de 20 fonts va obtenir 13 extraccions, 2 documents sense text que requereixen OCR i 5 errors de xarxa/HTTP. Aquesta mostra és diagnòstica i encara no alimenta el matching.

Els textos extrets es puntuen i es divideixen en fragments auditables amb:

```bash
npm run sources:chunk -- --limit 20
```

Cada fragment conserva ordre, contingut, longitud i hash. La qualitat assenyala textos curts, duplicats i extraccions HTML bàsiques.
# Connector de concert social i gestió delegada

La descoberta d'e-Tauler es pot executar amb `npm run concerts:discover`. El connector consulta les cerques paginades de `concert social` i `gestió delegada social`, torna a exigir localment l'expressió literal dins del títol o la descripció, uneix els resultats per identificador d'edicte i limita el període a 2024-2026. Aquest segon filtre evita incorporar coincidències àmplies retornades pel cercador d'e-Tauler que no contenen realment l'expressió social.

La descoberta és sempre el primer pas i genera `tmp/concerts-discovery.json` sense utilitzar credencials de Supabase. L'informe separa els actes que poden crear o ampliar una provisió de les pròrrogues, modificacions, autoritzacions de despesa, resolucions anticipades, baixes, cessions i esmenes.

La importació és una ordre separada i exigeix confirmar el recompte observat, per exemple `npm run concerts:import -- --confirm-count 305`. Si el recompte de l'informe no coincideix exactament, no s'escriu res. La càrrega és idempotent per `source_dataset + source_record_id`, registra l'execució a `import_runs` i verifica el total de `concerts` després de l'upsert. Si una nova descoberta exclou registres existents, només es poden retirar amb `--prune --confirm-delete N`, i mai si ja tenen activitat en un lot.

Cada edicte es conservarà com a esdeveniment. En la fase d'importació posterior, els documents i annexos de cada edicte s'hauran de descarregar i normalitzar per obtenir les provisions concretes sense comptar una pròrroga o una baixa com a finançament nou.

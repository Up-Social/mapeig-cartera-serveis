# Importació dels Excel consolidats

L'importador és `scripts/import-excels.ts`. Llegeix els quatre llibres autoritzats des d'una carpeta externa i fa `upsert` a Supabase per lots.

## Requisits

1. Docker Desktop en execució.
2. Supabase local iniciat amb `supabase start`.
3. `.env.local` amb `NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SECRET_KEY`.

## Execució

```bash
npm run data:import -- --source-dir "/ruta/a/la/carpeta"
```

Per validar una mostra sense importar-ho tot:

```bash
npm run data:import -- --source-dir "/ruta/a/la/carpeta" --limit 10
```

Per tornar a importar només el catàleg Master, sense modificar els registres de les altres fonts:

```bash
npm run data:import -- --source-dir "/ruta/a/la/carpeta" --master-only
```

La reexecució és segura: la clau única és `(source_dataset, source_record_id)` i els registres existents s'actualitzen.

## Fonts i correspondència

| Dataset | Llibre / full | Identificador | Títol | Import |
|---|---|---|---|---|
| `contractacions` | Contrataciones / Contrataciones | expedient + empremta de publicació | Denominación | Importe de adjudicación, amb alternatives |
| `convenis` | Convenios / Convenios | Número conveni definitiu | Títol conveni | Sumatori aportacions totals previstes |
| `raisc_ccaa` | Subvenciones / CCAA | Clau | Títol convocatòria català | Import subvenció / préstec / ajut |
| `raisc_local` | Subvenciones / Local | Clau | Títol convocatòria català | Import subvenció / préstec / ajut |

Cada fila conserva també `source_file`, `source_sheet`, `source_row`, `source_payload` i una empremta SHA-256 del contingut.

## Master

Els registres de `Tabla (resumen)` amb codi i nom s'importen a `master_services`. Aquesta taula queda separada de les provisiones de `source_records`. Les dues files fictícies de `Detalle_Provisiones` no s'importen com a dades reals.

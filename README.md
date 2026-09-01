# Mapeig cartera de serveis.

Prototip local per validar el processament controlat i el matching entre provisió pública i serveis de la Cartera de Serveis Socials.

## Arrencada local

```bash
supabase start
cp .env.example .env.local
supabase migration up --local
npm run dev
```

Completa `.env.local` amb les claus retornades per `supabase status`. La web queda disponible a `http://localhost:3000` i Supabase Studio a `http://localhost:54323`.

Configura també `APP_ACCESS_PASSWORD` amb una contrasenya llarga i única. Totes les pàgines, APIs i accions de servidor queden bloquejades per una sessió `HttpOnly`; si falta la variable, l'aplicació falla de manera tancada i només mostra la pantalla d'accés.

## Verificació del projecte

El projecte fixa Node.js 20 a `.nvmrc`. Abans d'integrar un canvi, executa:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

El mateix conjunt de comprovacions s'executa a GitHub Actions per a cada pull request i cada actualització de `main`.

## Flux disponible

- Consulta completa i filtrada dels registres importats.
- Mostres petites de 4 casos únics, equilibrades per tipologia de finançament.
- Preparació d'evidència i matching per lots persistents.
- Revisió humana amb candidats, evidència i fitxa del servei.
- Provisions normalitzades i exportació a una còpia del Master.
- Pàgina `Procés` amb la relació entre tipologies, fonts internes i matching.

Consulta [docs/INTERFACE_GUIDE.md](docs/INTERFACE_GUIDE.md) per seguir el procés pas a pas.

## Importar les dades de prova

```bash
npm run data:import -- --source-dir "/ruta/a/la/carpeta/amb/els/excel"
```

Consulta [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) per a les decisions i límits del PoC i [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md) per al detall de la importació.

## Descobrir i provar fonts externes

```bash
npm run sources:discover
npm run sources:sample -- --limit 20
```

L'extracció de PDF requereix `pdftotext`. Consulta [docs/SOURCE_EXTRACTION.md](docs/SOURCE_EXTRACTION.md) per als límits i resultats de la mostra.

# Prototipos SQL locales

Estas cuatro migraciones son experimentos cerrados: no forman parte de `supabase/migrations`, no deben aplicarse a un proyecto enlazado y no autorizan cambios remotos. Sus archivos se conservan sin alterar; el orden original es 310 → 320 y 330 → 340.

SHA-256 de los contenidos originales:

- `20261029031000_local_matching_equivalent_guard.sql`: `47a2d0c4d63d803e73f34cec13b0a185a84bece7e781202ad91944127c3c8305`
- `20261029032000_local_matching_group_reservation.sql`: `4b5421bf4002172c86b2d1af81b0ee22aa4d22461b39130229aff81811480b34`
- `20261029033000_batch_export_snapshot_prototype.sql`: `6642e4eb299994551778929cac43f7f01c5e719db12d337c1506d3e60cc31801`
- `20261029034000_batch_export_checked_prototype.sql`: `3ebc46f58c51656c6d7500e5ec1fb57644ff87f0422a489d6cb2c1f820ecab49`

En el proyecto Supabase de pruebas aislado y comprobado por `assertTestEnvironment`, `npm run test:sql -- --experiments` instala temporalmente los cuatro SQL en la transacción de cada prueba 75, 77, 79 y 81 y hace rollback. Sin `--experiments`, la suite estándar ejecuta los demás SQL. Los ensayos de concurrencia 76/78/80/82 son independientes y deben ejecutarse con sus propios requisitos de Docker; 80/82 ensamblan las migraciones activas y experimentales por versión en una base efímera.

Antes de preparar un release se debe comprobar el historial del destino y los consumidores, sin marcar versiones como aplicadas por inferencia. Los experimentos no deben reintroducirse en el directorio activo por accidente.

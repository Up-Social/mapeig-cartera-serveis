# Preparacion y subida a produccion

Esta guia describe el recorrido recomendado para trabajar con el proyecto desde Visual Studio Code y publicarlo mediante GitHub, Supabase y Vercel.

## 0. Estado actual y condicion de salida

La carpeta actual todavia no es una aplicacion desplegable. Contiene documentos, datos de trabajo y un prototipo visual en `.codex-edit`, pero no contiene todavia `package.json`, una aplicacion Next.js en `apps/web`, migraciones en `supabase/migrations` ni un repositorio Git inicializado.

No se debe intentar el despliegue de produccion hasta que existan, como minimo:

- `package.json` y un archivo de bloqueo de dependencias;
- `apps/web` con una aplicacion Next.js que compile;
- `supabase/migrations` con el esquema completo y las politicas RLS;
- scripts `lint`, `typecheck`, `test` y `build` ejecutables desde la raiz;
- `.env.example` sin valores secretos;
- pruebas de acceso con una cuenta sin privilegios administrativos.

La arquitectura objetivo es:

```text
Visual Studio Code -> rama Git -> GitHub -> CI
                                      |-> Vercel Preview / Production
                                      `-> migraciones Supabase staging / production
```

Vercel debe alojar la web y las operaciones cortas. Las extracciones y clasificaciones largas no deben ejecutarse dentro de una peticion web de Vercel: deben conservar el modelo de jobs persistentes descrito en `PIPELINE_IMPLEMENTATION_GUIDE.md` y ejecutarse por lotes mediante un worker apropiado.

## 1. Abrir y trabajar en Visual Studio Code

1. Instalar Visual Studio Code para macOS.
2. Abrir Visual Studio Code.
3. Pulsar `Cmd + Shift + P`.
4. Ejecutar `Shell Command: Install 'code' command in PATH`.
5. Cerrar y volver a abrir Terminal.
6. Abrir el proyecto:

```bash
cd "/Users/carlessanz/Documents/Codex/UPSocial - Cartera Serveis Socials : Finançament"
code .
```

Alternativamente, usar `File > Open Folder...` y elegir esta carpeta.

Extensiones recomendadas:

- ESLint;
- Prettier;
- GitHub Pull Requests and Issues;
- Supabase, si se desea ayuda para SQL y proyectos Supabase.

Comprobacion: el explorador de VS Code debe mostrar `PROJECT.md`, `PIPELINE_IMPLEMENTATION_GUIDE.md` y este archivo.

## 2. Preparar la aplicacion antes de publicarla

Implementar la estructura prevista en la guia tecnica:

```text
apps/web/
packages/
workers/
supabase/migrations/
tests/
```

Desde la raiz, los siguientes comandos deben existir y terminar correctamente:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Si se usa `pnpm`, sustituir los comandos de `npm` por los equivalentes y versionar `pnpm-lock.yaml`. No mezclar gestores de paquetes.

Crear `.env.example` con nombres, nunca con valores reales:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

Reglas de seguridad:

- `NEXT_PUBLIC_SUPABASE_URL` y la clave publica/anon pueden llegar al navegador, siempre bajo RLS.
- `SUPABASE_SERVICE_ROLE_KEY`, contrasenas y claves de IA son exclusivamente de servidor.
- No usar una variable con prefijo `NEXT_PUBLIC_` para ningun secreto.
- No subir `.env`, `.env.local`, volcados de base de datos ni credenciales JSON a GitHub.
- Mantener privados los buckets con documentos originales y usar autorizacion o URLs firmadas.

## 3. Crear los proyectos remotos de Supabase

Para un CI/CD seguro se recomiendan dos proyectos separados:

1. Crear `mapeig-cartera-staging` en Supabase.
2. Crear `mapeig-cartera-production` en Supabase.
3. Elegir una region europea adecuada y guardar las contrasenas de base de datos en un gestor de contrasenas.
4. Registrar para cada entorno:
   - Project Reference;
   - Project URL;
   - clave publica/anon;
   - service role key;
   - contrasena de la base de datos.
5. Activar `pgvector` mediante una migracion versionada, no solo desde el panel.
6. Crear buckets, politicas RLS, funciones y tablas mediante migraciones.

Si el esquema remoto ya se creo manualmente, importarlo una sola vez:

```bash
npx supabase login
npx supabase init
npx supabase link --project-ref ID_DEL_PROYECTO
npx supabase db pull
```

Revisar la migracion generada antes de versionarla. A partir de ese momento, todo cambio de esquema debe nacer como migracion:

```bash
npx supabase migration new nombre_del_cambio
```

Aplicacion manual inicial, primero en staging:

```bash
npx supabase link --project-ref ID_STAGING
npx supabase db push
npx supabase migration list
```

Repetir contra produccion solo cuando staging haya sido validado. Despues de activar CI/CD, no aplicar migraciones de produccion rutinariamente desde un portatil.

Comprobaciones en Supabase:

- todas las tablas expuestas tienen RLS activado;
- un usuario anonimo no puede leer ni modificar datos internos;
- el service role solo se utiliza en codigo de servidor;
- los buckets de documentos y snapshots no son publicos;
- las migraciones local y remota aparecen alineadas;
- existe una estrategia de copias de seguridad y restauracion ensayada.

## 4. Crear el repositorio en GitHub

1. Crear en GitHub un repositorio privado, por ejemplo `mapeig-cartera-serveis`.
2. No marcar la opcion de crear README si se va a subir esta carpeta tal como esta.
3. En la carpeta local ejecutar:

```bash
git init
git branch -M main
git add .
git status
git commit -m "chore: initial project setup"
git remote add origin URL_DEL_REPOSITORIO
git push -u origin main
```

Antes de `git add .`, revisar especialmente que no aparezcan `.env.local`, archivos temporales de Office, resultados generados ni credenciales. Decidir tambien si los Excel y PDF de referencia deben vivir en Git: son publicos segun el planteamiento del proyecto, pero aumentan el repositorio y sus condiciones de redistribucion deben estar documentadas. Para datasets crecientes o snapshots usar Supabase Storage, no Git.

Configurar en GitHub:

1. `Settings > Branches` o Rulesets para proteger `main`.
2. Exigir pull request antes del merge.
3. Exigir que pasen los checks de CI.
4. Bloquear force pushes y eliminacion de `main`.
5. Crear los entornos `staging` y `production` en `Settings > Environments`.
6. Requerir aprobacion manual para `production` si el plan de GitHub lo permite.

Flujo diario recomendado:

```bash
git switch -c feature/nombre-del-cambio
# editar y probar
git add archivos_concretos
git commit -m "feat: descripcion breve"
git push -u origin feature/nombre-del-cambio
```

Abrir un pull request. Vercel creara una Preview; la CI validara el codigo. Solo despues se fusiona en `main`.

## 5. Configurar CI para cada pull request

Crear `.github/workflows/ci.yml` cuando existan los scripts de la seccion 2. El flujo debe ejecutarse en pull requests y pushes a `main`, y realizar:

1. checkout;
2. instalacion de la version de Node fijada por el proyecto;
3. instalacion reproducible con `npm ci`;
4. lint;
5. comprobacion de tipos;
6. tests;
7. build de Next.js.

Ejemplo de referencia:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Fijar la version real de Node tambien en `package.json` y verificar que sea compatible con la version de Next.js elegida.

## 6. Automatizar las migraciones de Supabase

Usar GitHub Actions para aplicar migraciones; no introducir las claves privadas de Supabase en Vercel si la web no las necesita.

Secretos recomendados por entorno de GitHub:

- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`;
- `SUPABASE_PROJECT_ID`.

Politica recomendada:

- pull request: validar formato, SQL y tests, sin tocar produccion;
- rama `staging`: aplicar migraciones al proyecto Supabase de staging;
- rama `main`: aplicar a produccion, despues de CI y de la aprobacion del entorno `production`.

El paso de despliegue de esquema utiliza la CLI fijada a una version concreta:

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_ID"
npx supabase db push
```

El workflow debe declarar `environment: staging` o `environment: production` para recibir solamente los secretos del destino correcto. No cargar datos de ejemplo en produccion mediante la migracion de esquema. Los cambios destructivos requieren una estrategia de varias fases: agregar lo nuevo, migrar/verificar datos y retirar lo antiguo en una entrega posterior.

## 7. Conectar GitHub con Vercel

La opcion mas simple y recomendable es usar la integracion Git de Vercel para el despliegue y reservar GitHub Actions para validar codigo y migraciones. Asi se evita desplegar dos veces el mismo commit.

1. Entrar en Vercel con la cuenta de GitHub.
2. Elegir `Add New > Project`.
3. Importar el repositorio privado.
4. Seleccionar como Root Directory `apps/web` si la aplicacion Next.js esta ahi.
5. Confirmar el preset Next.js.
6. Revisar los comandos de instalacion y build para el monorepo.
7. Configurar `main` como Production Branch.
8. No pulsar Deploy hasta haber configurado las variables.

Vercel creara normalmente:

- un Preview Deployment para las ramas y pull requests;
- un Production Deployment al fusionar en `main`.

No crear simultaneamente un workflow que ejecute `vercel deploy` salvo que se decida abandonar el despliegue automatico de la integracion Git.

## 8. Configurar variables en Vercel

En `Project > Settings > Environment Variables`, crear como minimo:

| Variable | Preview | Production | Exposicion |
|---|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL staging | URL production | navegador |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave staging | clave production | navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | service role staging | service role production | solo servidor |
| `OPENAI_API_KEY` | clave limitada de pruebas | clave production | solo servidor |

Usar nombres distintos o el selector de entorno de Vercel para impedir que una Preview apunte a la base de produccion. Tras cambiar variables, volver a desplegar: un despliegue existente no incorpora automaticamente el nuevo valor.

Si la aplicacion no necesita service role o IA durante una peticion web, no configurar esas claves en Vercel; mantenerlas solo en el ejecutor de workers.

## 9. Orden correcto de una entrega

Para cada cambio:

1. Crear una rama `feature/...` desde `main`.
2. Desarrollar y probar localmente.
3. Crear las migraciones necesarias.
4. Subir la rama y abrir un pull request.
5. Esperar a que CI quede verde.
6. Revisar el Preview de Vercel, conectado exclusivamente a Supabase staging.
7. Aplicar y verificar la migracion en staging.
8. Revisar RLS, autenticacion, errores y operaciones criticas.
9. Aprobar y fusionar el pull request.
10. Aplicar la migracion de produccion mediante GitHub Actions.
11. Desplegar la web de produccion desde `main` mediante Vercel.
12. Ejecutar comprobaciones rapidas y revisar logs.

Cuando una version de la web depende de una columna nueva, mantener compatibilidad durante el despliegue: primero agregar la columna o tabla, despues desplegar el codigo que la usa y solo en una entrega posterior eliminar la estructura antigua.

## 10. Lista de comprobacion antes de produccion

- [ ] El repositorio de GitHub es privado y `main` esta protegida.
- [ ] CI pasa desde una instalacion limpia.
- [ ] No hay secretos ni datos personales en el historial Git.
- [ ] Preview usa Supabase staging y Production usa Supabase production.
- [ ] Las migraciones estan versionadas y probadas en staging.
- [ ] RLS esta activa y probada con roles anonimo y autenticado.
- [ ] Los buckets sensibles son privados.
- [ ] Las rutas administrativas requieren autorizacion del servidor.
- [ ] Los jobs largos no dependen de una peticion web de Vercel.
- [ ] Hay limites, reintentos e idempotencia en los workers.
- [ ] Se han probado copias de seguridad y restauracion.
- [ ] Existe monitorizacion de errores y un responsable de alertas.
- [ ] Se ha ensayado la vuelta atras de la web y de los cambios de datos.
- [ ] Dominio, HTTPS y URLs de redireccion de Supabase Auth son correctos.
- [ ] Se ha realizado una prueba funcional completa con una cuenta de permisos minimos.

## 11. Vuelta atras

Web:

1. Identificar el ultimo deployment sano en Vercel.
2. Promoverlo o revertir en Git el cambio causante.
3. Confirmar que las variables del entorno siguen siendo correctas.

Base de datos:

1. No deshacer automaticamente una migracion que ya haya transformado datos.
2. Detener las escrituras afectadas si existe riesgo de corrupcion.
3. Aplicar una migracion correctiva hacia delante.
4. Restaurar una copia solo si se ha evaluado la perdida de datos posteriores al backup.

## 12. Documentacion oficial de referencia

- Supabase, entornos y migraciones: https://supabase.com/docs/guides/deployment/managing-environments
- Vercel, repositorios Git: https://vercel.com/docs/git
- Vercel, monorepos: https://vercel.com/docs/monorepos
- GitHub, entornos de despliegue: https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments
- Visual Studio Code en macOS: https://code.visualstudio.com/docs/setup/mac

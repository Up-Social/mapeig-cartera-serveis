import { LockKeyhole, Waypoints } from "lucide-react";

type LoginPageProps = {
  searchParams: Promise<{
    config?: string;
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configurationMissing =
    params.config === "missing" || !process.env.APP_ACCESS_PASSWORD;
  const returnPath =
    params.next?.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <section className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-sm ring-1 ring-foreground/10 sm:p-8">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Waypoints className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          UPSocial · Accés restringit
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Mapeig cartera de serveis
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Introdueix la contrasenya de la prova de concepte per continuar.
        </p>

        {configurationMissing ? (
          <p role="alert" className="mt-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            Falta configurar <code>APP_ACCESS_PASSWORD</code> al servidor.
          </p>
        ) : (
          <form action="/api/access/login" method="post" className="mt-6 space-y-4">
            <input type="hidden" name="next" value={returnPath} />
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Contrasenya
              </label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  className="h-10 w-full rounded-md border border-input bg-background pr-3 pl-10 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>
            {params.error === "invalid" && (
              <p role="alert" className="text-sm text-destructive">
                La contrasenya no és correcta.
              </p>
            )}
            <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
              Entrar
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

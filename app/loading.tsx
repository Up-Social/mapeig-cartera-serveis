export default function LoadingPage() {
  return <main className="page-shell" aria-busy="true" aria-live="polite">
    <section className="page-container space-y-4">
      <p className="text-sm text-muted-foreground">Carregant la informació…</p>
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
    </section>
  </main>;
}

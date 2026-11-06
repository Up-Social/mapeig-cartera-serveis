export default function LoadingExports(){
 return <main className="page-shell" aria-busy="true"><section className="page-container space-y-4">
  <p className="flex items-center gap-2 text-sm text-muted-foreground"><span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"/>Analitzant els registres per calcular el resum de l’exportació…</p>
  <div className="h-48 animate-pulse rounded-xl bg-muted"/><div className="h-32 animate-pulse rounded-xl bg-muted"/>
 </section></main>;
}

import { formatReferenceValue, isIllustrativeReference, referenceEntries, referenceFieldLabel } from "@/lib/master-reference";

export function MasterReferenceData({ payload }: { payload: Record<string, unknown> }) {
  const formulas = referenceEntries(payload, true);
  const value = (key: string) => formatReferenceValue(key, payload[key]);
  return <div className="space-y-5">
    {isIllustrativeReference(payload) && <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Exemple il·lustratiu del llibre d’origen. No correspon a un cas real acreditat.</p>}
    <section className="surface p-5">
      <h2 className="section-title">Dades del servei al fitxer de referència</h2>
      <dl className="card-fields mt-4 text-sm">{["Estado", "Código Cartera", "Nombre del servicio", "Ámbito sectorial / colectivo", "Plazas / capacidad", "Nº entidades prestadoras", "Confianza general"].map(key => <div key={key}><dt className="font-semibold text-muted-foreground">{referenceFieldLabel(key)}</dt><dd className="mt-1">{value(key)}</dd></div>)}</dl>
    </section>
    <section className="surface p-5">
      <h2 className="section-title">Finançament al fitxer de referència</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Valors guardats al llibre quan es va importar. No són els totals actuals dels registres de l’aplicació ni acrediten finançament. Un zero és el valor importat; «No informat» indica que el fitxer no aporta el valor. Les fórmules no es recalculen aquí.</p>
      <dl className="card-fields mt-4 text-sm">{["Importe total", "Mecanismo dominante", "% Drets Socials", "% otros departamentos"].map(key => <div key={key}><dt className="font-semibold text-muted-foreground">{referenceFieldLabel(key)}</dt><dd className="mt-1">{value(key)}</dd></div>)}</dl>
      <div className="card-fields mt-5">{[["Concierto", "Concerts"], ["Subvención", "Subvencions"], ["Convenio", "Convenis"], ["Contratación", "Contractacions"]].map(([key, label]) => <section className="rounded-lg border p-4" key={key}><h3 className="subsection-title">{label}</h3><dl className="mt-3 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-x-4"><dt>Import importat</dt><dd className="font-semibold">{value(`${key} importe`)}</dd></div><div className="flex flex-wrap justify-between gap-x-4"><dt>Provisions al llibre</dt><dd>{value(`${key} provisiones`)}</dd></div></dl></section>)}</div>
    </section>
    <details className="surface p-5">
      <summary className="cursor-pointer font-semibold">Veure dades originals i fórmules d’Excel</summary>
      <p className="mt-3 text-sm text-muted-foreground">Auditoria del fitxer importat. Es conserven els noms de les columnes i els valors originals; els camps buits es mostren com «No informat».</p>
      <dl className="card-fields mt-4 text-sm">{referenceEntries(payload, false).map(([key, raw]) => <div key={key}><dt className="font-semibold text-muted-foreground">{key}</dt><dd className="mt-1 whitespace-pre-wrap">{raw == null || raw === "" ? "No informat" : typeof raw === "object" ? JSON.stringify(raw) : String(raw)}</dd></div>)}</dl>
      {formulas.length > 0 && <section className="mt-5 border-t pt-4"><h3 className="subsection-title">Fórmules originals · només auditoria</h3><p className="mt-2 text-sm text-muted-foreground">Referències internes del llibre; no són dades del servei ni càlculs executats per l’aplicació.</p><dl className="mt-4 space-y-4 text-sm">{formulas.map(([key, raw]) => <div className="min-w-0" key={key}><dt className="font-semibold">{key}</dt><dd className="mt-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">{formatReferenceValue(key, raw)}</dd></div>)}</dl></section>}
    </details>
  </div>;
}

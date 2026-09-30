"use client";

import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { WorkTable } from "@/components/work-list";
import { DISCARD_REASON_LABELS } from "@/lib/review-contract";
import { FINANCING_TYPE_LABELS } from "@/lib/financing-types";

export type SelectableDiscard = {
  id: string;
  job_id: string;
  result_token: string;
  source_record_id: string;
  source_dataset: string;
  financing_type: string;
  title: string;
  batch_number: number | null;
  human_reviewed: boolean;
  job_created_at: string | null;
  reasons: string[] | null;
  explanation: string;
  evidence: Array<{ content: string }> | null;
};

export function DiscardedSelection({ rows, origin }: { rows: SelectableDiscard[]; origin: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const items = rows.filter((row) => selected.includes(row.id));
  const allVisible = rows.length > 0 && items.length === rows.length;

  function toggle(id: string, checked: boolean) {
    setSelected(checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id));
  }

  function remove() {
    start(async () => {
      try {
        const response = await fetch("/api/discarded/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: items.map(({ id, job_id, result_token }) => ({ id, job_id, result_token })), confirmedCount: items.length }) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setSelected([]);
        setOpen(false);
        setMessage(result.pending ? "Registres eliminats; neteja de fitxers pendent." : "Eliminació completa; absència de fitxers verificada.");
        window.dispatchEvent(new Event("navigation-counts:refresh"));
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No s’ha eliminat cap registre.");
      }
    });
  }

  return <section className="space-y-3">
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={pending || !rows.length} onClick={() => setSelected(allVisible ? [] : rows.map((row) => row.id))}>{allVisible ? "Desseleccionar visibles" : "Seleccionar visibles"}</Button><span className="text-sm">{items.length} seleccionats</span></div>
      <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger render={<Button variant="outline" disabled={!items.length || pending} />}>Eliminar seleccionats</Dialog.Trigger><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30"/><Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(95vw,45rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5"><Dialog.Title className="text-lg font-semibold">Eliminar definitivament {items.length} registres?</Dialog.Title><Dialog.Description className="my-3 text-sm">S’eliminaran registres, resultats, evidències i fitxers originals de l’aplicació. No es pot desfer. Els Excel descarregats fora de l’aplicació no s’eliminen.</Dialog.Description><ul className="space-y-2 text-sm">{items.map((row) => <li key={row.id} className="rounded border p-2">{row.source_record_id}<br/><span className="break-all font-mono text-xs">{row.id}</span></li>)}</ul><div className="mt-4 flex flex-wrap gap-3"><Dialog.Close render={<Button variant="outline" disabled={pending}/>}>Cancel·lar</Dialog.Close><Button disabled={pending} onClick={remove}>{pending ? "Verificant i eliminant…" : `Confirmo l’eliminació de ${items.length}`}</Button></div></Dialog.Popup></Dialog.Portal></Dialog.Root>
    </div>
    {message && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p>}
    <WorkTable headings={["", "Cas", "Motiu", "Revisió", "Lot", "Acció"]} empty={rows.length ? undefined : "No hi ha casos descartats amb aquests filtres."}>
      {rows.map((row) => <tr key={row.id}>
        <td data-label="Seleccionar"><input type="checkbox" className="size-4 accent-black" aria-label={`Seleccionar ${row.source_record_id}`} disabled={pending} checked={selected.includes(row.id)} onChange={event => toggle(row.id, event.target.checked)}/></td>
        <td data-label="Cas"><Link className="font-semibold underline underline-offset-2" href={`/records/${row.id}?${new URLSearchParams({ from: origin, job: row.job_id })}`}>{row.title}</Link><p className="mt-1 text-xs text-muted-foreground">{row.source_record_id} · {FINANCING_TYPE_LABELS[row.financing_type as keyof typeof FINANCING_TYPE_LABELS] ?? row.financing_type}</p></td>
        <td data-label="Motiu">{row.reasons?.map(reason => DISCARD_REASON_LABELS[reason] ?? reason).join(", ") || "Motiu no registrat"}</td>
        <td data-label="Revisió"><span className={`rounded-md border px-2 py-1 text-xs ${row.human_reviewed ? "status-neutral" : "status-warning"}`}>{row.human_reviewed ? "Validat" : "Pendent"}</span></td>
        <td data-label="Lot">{row.batch_number ?? "—"}</td>
        <td data-label="Acció"><Link className="inline-block rounded-md border px-3 py-2 text-sm font-medium" href={`/records/${row.id}?${new URLSearchParams({ from: origin, job: row.job_id })}`}>Veure cas</Link></td>
      </tr>)}
    </WorkTable>
  </section>;
}

export function PurgePending({ batches }: { batches: { id: string; record_count: number }[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  if (!batches.length) return null;
  return <section className="space-y-2 rounded border p-4"><h2 className="font-semibold">Registres eliminats; neteja de fitxers pendent</h2>{batches.map((batch) => <div key={batch.id} className="flex flex-wrap items-center gap-3 text-sm"><span>{batch.record_count} registres</span><Button variant="outline" disabled={pending} onClick={() => start(async () => { try { const response = await fetch(`/api/discarded/purge/${batch.id}`, { method: "POST" }); const value = await response.json(); setMessage(response.ok && value.complete ? "Neteja verificada." : "La neteja continua pendent."); router.refresh(); } catch { setMessage("No s’ha pogut completar la neteja."); } })}>Reintentar neteja</Button></div>)}<p role="status">{message}</p></section>;
}

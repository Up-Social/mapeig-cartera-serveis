import Link from "next/link";
import { notFound } from "next/navigation";
import { getBatch, getCloudResourceBlock } from "@/lib/batches";
import { isUuid } from "@/lib/uuid";
import { BatchStudy } from "./study";

export default async function BatchPage({ params }: PageProps<"/batches/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [batch, cloudBlock] = await Promise.all([getBatch(id), getCloudResourceBlock()]);
  if (!batch) notFound();
  return <main className="page-shell"><section className="page-container space-y-5"><Link className="text-sm underline" href="/batches">← Tornar als lots</Link><div><p className="page-eyebrow">Flux automatitzat</p><h1 className="page-title">Lot {batch.batchNumber}</h1><p className="page-description">{batch.selectedCount} registres · {batch.reviewCount} per revisar · {batch.errorCount} errors tècnics</p></div><BatchStudy initialBatch={batch} cloudBlock={cloudBlock}/></section></main>;
}

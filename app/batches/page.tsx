import { getBatch, getBatches } from "@/lib/batches";
import { BatchesWorkbench } from "./batches-workbench";
import {BatchRerun} from '@/components/batch-rerun';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function BatchesPage({ searchParams }: Props) {
  const params = await searchParams;
  const batchId = typeof params.batch === "string" ? params.batch : null;
  const [batches, activeBatch] = await Promise.all([
    getBatches(),
    batchId ? getBatch(batchId) : Promise.resolve(null),
  ]);
  return (
    <><BatchesWorkbench
      batches={batches}
      activeBatch={activeBatch ?? batches[0] ?? null}
    />{(activeBatch??batches[0])&&<div className="mx-auto max-w-6xl p-5"><BatchRerun key={(activeBatch??batches[0]).id} id={(activeBatch??batches[0]).id}/></div>}</>
  );
}

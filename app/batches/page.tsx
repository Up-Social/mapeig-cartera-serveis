import { getBatch, getBatches, getCloudResourceBlock } from "@/lib/batches";
import { BatchesWorkbench } from "./batches-workbench";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function BatchesPage({ searchParams }: Props) {
  const params = await searchParams;
  const batchId = typeof params.batch === "string" ? params.batch : null;
  const [batches, activeBatch, cloudBlock] = await Promise.all([
    getBatches(),
    batchId ? getBatch(batchId) : Promise.resolve(null),
    getCloudResourceBlock(),
  ]);
  return (
    <BatchesWorkbench
      batches={batches}
      activeBatch={activeBatch ?? batches[0] ?? null}
      cloudBlock={cloudBlock}
    />
  );
}

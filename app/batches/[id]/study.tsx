"use client";
import { useState } from "react";
import type { BatchSummary, CloudResourceBlock } from "@/lib/batch-types";
import { BatchDetail } from "../batches-workbench";
export function BatchStudy({ initialBatch, cloudBlock }: { initialBatch: BatchSummary; cloudBlock: CloudResourceBlock }) {
  const [batch, setBatch] = useState(initialBatch);
  return <section className="surface p-5"><BatchDetail batch={batch} cloudBlock={cloudBlock} onUpdate={setBatch}/></section>;
}

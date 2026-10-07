"use client";
import { useState } from "react";
import type { BatchSummary, CloudResourceBlock } from "@/lib/batch-types";
import type {EuroReferenceRate} from '@/lib/currency';
import { BatchDetail } from "../batches-workbench";
export function BatchStudy({ initialBatch, cloudBlock, euroRate }: { initialBatch: BatchSummary; cloudBlock: CloudResourceBlock; euroRate:EuroReferenceRate|null }) {
  const [batch, setBatch] = useState(initialBatch);
  return <section className="surface p-5"><BatchDetail batch={batch} cloudBlock={cloudBlock} euroRate={euroRate} onUpdate={setBatch}/></section>;
}

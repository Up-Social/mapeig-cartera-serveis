export type ProgressState = "pending" | "running" | "completed" | "error";
export type PhaseProgress = {
  state: ProgressState;
  completed: number;
  errors: number;
  total: number;
};

export function phaseState(
  currentStage: string,
  phase: "preparation" | "enrichment" | "matching",
  completed: number,
  errors: number,
  total: number,
): ProgressState {
  const order = { preparation: 0, enrichment: 1, matching: 2, review: 3, completed: 3 };
  const current = order[currentStage as keyof typeof order] ?? 0;
  const target = order[phase];
  if (current === target && completed + errors < total) return "running";
  if (current > target || completed + errors >= total)
    return completed === 0 && errors > 0 ? "error" : "completed";
  return "pending";
}

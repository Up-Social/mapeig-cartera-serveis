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
  if (total <= 0) return "pending";
  const order = { queued: -1, preparation: 0, enrichment: 1, matching: 2, review: 3, completed: 3 };
  const current = order[currentStage as keyof typeof order] ?? -1;
  const target = order[phase];
  if (completed + errors >= total) return errors > 0 ? "error" : "completed";
  if (current < target) return "pending";
  if (current > target && completed + errors === 0) return "pending";
  return "running";
}

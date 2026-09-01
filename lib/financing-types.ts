export const FINANCING_TYPES = ["contractacio", "conveni", "subvencio", "concert"] as const;
export type FinancingType = typeof FINANCING_TYPES[number];

export const FINANCING_TYPE_LABELS: Record<FinancingType, string> = {
  contractacio: "Contractació pública",
  conveni: "Conveni",
  subvencio: "Subvenció",
  concert: "Concert social / gestió delegada",
};

export const SOURCE_LABELS: Record<string, string> = {
  contractacions: "PSCP · Contractacions",
  convenis: "Registre de Convenis",
  raisc_ccaa: "RAISC · Generalitat",
  raisc_local: "RAISC · Administració local",
};

export function financingTypeForDataset(dataset: string): FinancingType | null {
  if (dataset === "contractacions") return "contractacio";
  if (dataset === "convenis") return "conveni";
  if (dataset === "raisc_ccaa" || dataset === "raisc_local") return "subvencio";
  if (dataset === "concerts") return "concert";
  return null;
}

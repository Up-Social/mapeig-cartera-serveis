export function sourceDocumentTypeLabel(type: string) {
  return labelFrom({
    regulatory_basis: "Bases reguladores",
    annex: "Annex",
    agreement: "Conveni",
    publication: "Publicació",
    contracting_profile: "Perfil del contractant",
    other: "Altres",
  }, type);
}

export function sourceDocumentStatusLabel(status: string) {
  return labelFrom({
    discovered: "Descoberta",
    fetching: "Descarregant",
    fetched: "Text extret",
    unsupported: "Format no compatible",
    error: "Error",
  }, status);
}

export function portfolioStatusLabel(status: string) {
  return labelFrom({
    Dentro: "Dins de la Cartera",
    "Fuera - candidato a entrar en Cartera": "Fora · candidat",
    "Fuera - no candidato a entrar en Cartera": "Fora · no candidat",
  }, status);
}

export function entityValidationStatusLabel(status: string) {
  return labelFrom({
    verified_nif: "NIF verificat",
    verified: "Verificada",
    pending: "Pendent de verificació",
    unverified: "No verificada",
  }, status);
}

export function catalogRelationTypeLabel(type: string) {
  return labelFrom({ confirmed: "confirmada", auxiliary: "auxiliar" }, type);
}

function labelFrom(labels: Record<string, string>, value: string) {
  return labels[value] ?? value.replaceAll("_", " ");
}

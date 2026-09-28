const SAFE_MESSAGES = [
  /mida del lot/iu,
  /identificador.+no vàlid/iu,
  /operació no vàlida/iu,
  /processament no disponible/iu,
  /no hi ha.+disponible/iu,
  /ja (?:havia estat|està) seleccionat/iu,
  /pendent de revisió/iu,
  /evidència insuficient/iu,
];

export function publicErrorMessage(error: unknown, fallback = "No s’ha pogut completar l’operació.") {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_MESSAGES.some((pattern) => pattern.test(message))) return message.slice(0, 240);
  if (/budget/iu.test(message)) return "S’ha assolit el límit preventiu de cost. Revisa el pressupost abans de continuar.";
  if (/quota/iu.test(message)) return "El servei ha aturat temporalment el procés per límit de quota.";
  if (/active_task|actiu/iu.test(message)) return "Ja hi ha un procés actiu per a aquest registre.";
  if (/provider_unknown/iu.test(message)) return "Hi ha una resposta externa pendent de confirmar. No es repetirà la petició automàticament.";
  return fallback;
}

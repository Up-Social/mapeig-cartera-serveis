import type { Classification } from "./analysis-contract";
import type { BatchJob } from "./batch-types";

export type BatchResultGuidance = {
  kind: "review" | "issue" | "technical" | "waiting" | "completed";
  label: string;
  title: string;
  explanation: string;
  nextStep: string;
  technicalDetail: string | null;
  phase: string | null;
};

const REVIEW_TITLES: Record<Classification, string> = {
  in_portfolio: "Cal validar la correspondència amb la Cartera",
  out_of_portfolio: "Cal confirmar que queda fora de la Cartera",
  discarded: "Cal confirmar el descart",
  insufficient_evidence: "Cal revisar la falta d’evidència",
};

export function batchResultGuidance(job: BatchJob): BatchResultGuidance {
  if (job.status === "error") return technicalGuidance(job);

  if (job.status === "needs_review" && (job.currentDestination === "issues" || job.analysis?.classification === "insufficient_evidence")) {
    const insufficient = job.analysis?.classification === "insufficient_evidence";
    return {
      kind: "issue",
      label: insufficient ? "Incidència · evidència insuficient" : "Incidència · resultat no fiable",
      title: insufficient ? "No hi ha una proposta revisable amb prou evidència" : "Cal tornar a contrastar aquest resultat",
      explanation: insufficient ? job.analysis?.explanation?.trim() || "La documentació no acredita prou bé els camps necessaris per classificar el servei." : "El resultat automàtic no és fiable i no es pot presentar com a proposta pendent de validació.",
      nextStep: insufficient ? "Obre el registre des d’Incidències, comprova les fonts i documenta la falta d’evidència o completa la informació abans de revisar-lo." : "Obre el registre des d’Incidències, comprova les fonts i reprèn l’anàlisi abans de validar cap proposta.",
      technicalDetail: null,
      phase: null,
    };
  }

  if (job.status === "needs_review") {
    const classification = job.analysis?.classification;
    return {
      kind: "review",
      label: "Revisió humana pendent",
      title: classification
        ? REVIEW_TITLES[classification]
        : "Cal validar el resultat automàtic",
      explanation:
        job.analysis?.explanation?.trim() ||
        "El procés automàtic ha acabat, però no hi ha prou informació registrada per donar el resultat per validat.",
      nextStep:
        classification === "insufficient_evidence"
          ? "Comprova la font i l’evidència disponible i indica si es pot classificar o si cal mantenir l’evidència insuficient."
          : "Comprova la proposta, l’evidència i els destinataris abans de confirmar o rectificar el resultat.",
      technicalDetail: null,
      phase: null,
    };
  }

  if (job.status === "approved" || job.status === "corrected" || job.status === "rejected" || job.status === "insufficient_evidence") {
    return {
      kind: "completed",
      label: "Revisió completada",
      title: "Resultat validat",
      explanation:
        job.analysis?.review_notes?.trim() ||
        job.analysis?.explanation?.trim() ||
        "Aquest resultat ja ha estat revisat.",
      nextStep: "Pots consultar la decisió, la justificació i l’evidència conservada.",
      technicalDetail: null,
      phase: null,
    };
  }

  return {
    kind: "waiting",
    label: "Processament pendent",
    title: "Encara no hi ha un resultat per revisar",
    explanation:
      job.preparationMessage?.trim() ||
      "El registre encara està pendent d’una fase automàtica o ha quedat bloquejat per una incidència anterior.",
    nextStep: "Consulta el detall de les fases del lot per veure on s’ha aturat.",
    technicalDetail: null,
    phase: blockedPhase(job),
  };
}

function technicalGuidance(job: BatchJob): BatchResultGuidance {
  const technicalDetail = firstMessage(job);
  const normalized = technicalDetail.toLocaleLowerCase("ca");
  const phase = failedPhase(job);

  if (
    normalized.includes("document no processable") ||
    normalized.includes("document no es pot processar") ||
    normalized.includes("sense text")
  ) {
    return {
      kind: "technical",
      label: "Errors tècnics",
      title: "No s’ha pogut llegir cap document útil",
      explanation:
        "S’ha localitzat una font, però el sistema no n’ha pogut extreure prou text per contrastar el registre. Pot ser un document escanejat, un enllaç inaccessible o un format que necessita OCR.",
      nextStep:
        "Obre la incidència per revisar la font i tornar a preparar el registre amb OCR si correspon.",
      technicalDetail,
      phase,
    };
  }

  if (normalized.includes("no_source") || normalized.includes("sense font")) {
    return {
      kind: "technical",
      label: "Errors tècnics",
      title: "No s’ha trobat una font oficial utilitzable",
      explanation:
        "El procés no ha localitzat un document oficial que permeti contrastar la informació del registre.",
      nextStep: "Obre la incidència per revisar o afegir la font correcta i reintentar la preparació.",
      technicalDetail,
      phase,
    };
  }

  if (phase === "Contrast de dades") {
    return {
      kind: "technical",
      label: "Errors tècnics",
      title: "No s’ha pogut completar el contrast de dades",
      explanation:
        "La font estava preparada, però el sistema no ha pogut estructurar o contrastar la informació necessària.",
      nextStep: "Obre la incidència per consultar el diagnòstic i reintentar el contrast.",
      technicalDetail,
      phase,
    };
  }

  if (phase === "Correspondència amb la Cartera") {
    return {
      kind: "technical",
      label: "Errors tècnics",
      title: "No s’ha pogut completar la correspondència",
      explanation:
        "El sistema no ha pogut generar una classificació completa a partir de les dades contrastades.",
      nextStep: "Obre la incidència per consultar el diagnòstic i reintentar la correspondència.",
      technicalDetail,
      phase,
    };
  }

  return {
    kind: "technical",
    label: "Errors tècnics",
    title: "El processament no s’ha pogut completar",
    explanation:
      "Una de les fases automàtiques ha fallat abans de generar un resultat revisable.",
    nextStep: "Obre la incidència per veure el diagnòstic i l’acció recomanada.",
    technicalDetail,
    phase,
  };
}

function firstMessage(job: BatchJob) {
  return (
    job.errorMessage?.trim() ||
    job.enrichmentError?.trim() ||
    job.preparationMessage?.trim() ||
    "Sense detall tècnic registrat."
  );
}

function failedPhase(job: BatchJob) {
  if (job.phases?.preparation === "error" || job.preparationStatus === "error") {
    return "Preparació de fonts";
  }
  if (job.phases?.enrichment === "error" || job.enrichmentStatus === "error") {
    return "Contrast de dades";
  }
  if (job.phases?.matching === "error") return "Correspondència amb la Cartera";
  return null;
}

function blockedPhase(job: BatchJob) {
  if (job.phases?.preparation === "blocked") return "Preparació de fonts";
  if (job.phases?.enrichment === "blocked") return "Contrast de dades";
  if (job.phases?.matching === "blocked") return "Correspondència amb la Cartera";
  return null;
}

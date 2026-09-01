import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SourceRecord } from "./types";

const demoRecords: SourceRecord[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    sourceDataset: "RAISC",
    sourceRecordId: "CC002-23-006-1",
    mechanism: "Subvenció",
    title: "Transport adaptat individual i col·lectiu a la comarca",
    providerName: "Entitat beneficiària de prova",
    amount: 48500,
    status: "pendent",
    carteraCode: null,
    carteraName: null,
    confidence: null,
    evidence: null,
    suggestedCode: "1.2.2.1.3",
    suggestedName: "Servei de transport adaptat",
    suggestedConfidence: 0.96,
    suggestedEvidence: "El títol de la concessió identifica explícitament el transport adaptat.",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    sourceDataset: "Convenis",
    sourceRecordId: "2024/11/0014",
    mechanism: "Conveni",
    title: "Cofinançament de l'Equip d'Atenció a la Infància i l'Adolescència",
    providerName: null,
    amount: 126000,
    status: "pendent",
    carteraCode: null,
    carteraName: null,
    confidence: null,
    evidence: null,
    suggestedCode: "1.2.1.2",
    suggestedName: "Servei especialitzat d'atenció a la infància i a l'adolescència (SEAIA)",
    suggestedConfidence: 0.91,
    suggestedEvidence: "L'objecte identifica l'EAIA, però cal validar el rol de les parts signants.",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    sourceDataset: "PSCP",
    sourceRecordId: "2026/68",
    mechanism: "Contractació pública",
    title: "Servei de formació i monitoratge en criança positiva per a famílies",
    providerName: "Adjudicatari de prova",
    amount: 73200,
    status: "pendent",
    carteraCode: null,
    carteraName: null,
    confidence: null,
    evidence: null,
    suggestedCode: "1.2.11.1",
    suggestedName: "Servei d'atenció a les famílies",
    suggestedConfidence: 0.78,
    suggestedEvidence: "El programa s'adreça a famílies, però la documentació no cita un servei oficial concret.",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    sourceDataset: "e-Tauler",
    sourceRecordId: "EDICTE-2025-0142",
    mechanism: "Concert social",
    title: "Provisió de places de centre residencial per a persones amb discapacitat intel·lectual",
    providerName: "Entitat acreditada de prova",
    amount: 310000,
    status: "pendent",
    carteraCode: null,
    carteraName: null,
    confidence: null,
    evidence: null,
    suggestedCode: "1.2.6.2.3.3",
    suggestedName: "Serveis de centre residencial per a persones amb discapacitat intel·lectual",
    suggestedConfidence: 0.94,
    suggestedEvidence: "La resolució descriu la tipologia residencial i la població destinatària.",
  },
];

export async function getSourceRecords(): Promise<SourceRecord[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return demoRecords;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("source_records")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error || !data?.length) return demoRecords;

  return data.map((row) => ({
    id: row.id,
    sourceDataset: row.source_dataset,
    sourceRecordId: row.source_record_id,
    mechanism: row.mechanism,
    title: row.title,
    providerName: row.provider_name,
    amount: row.amount == null ? null : Number(row.amount),
    status: row.processing_status,
    carteraCode: row.cartera_code,
    carteraName: row.cartera_name,
    confidence: row.confidence == null ? null : Number(row.confidence),
    evidence: row.evidence,
    suggestedCode: row.suggested_code,
    suggestedName: row.suggested_name,
    suggestedConfidence: Number(row.suggested_confidence),
    suggestedEvidence: row.suggested_evidence,
  }));
}

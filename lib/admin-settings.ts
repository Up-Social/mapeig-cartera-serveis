import "server-only";

import { createServerSupabase } from "./records-page";

export type AutomaticOcrSetting = {
  enabled: boolean;
  updatedAt: string | null;
};

const AUTOMATIC_OCR_KEY = "automatic_ocr";

export async function getAutomaticOcrSetting(): Promise<AutomaticOcrSetting> {
  const { data, error } = await createServerSupabase()
    .from("app_settings")
    .select("enabled,updated_at")
    .eq("key", AUTOMATIC_OCR_KEY)
    .maybeSingle();

  if (error) throw error;
  return {
    enabled: data?.enabled ?? true,
    updatedAt: data?.updated_at ?? null,
  };
}

export async function getAutomaticOcrEnabled() {
  return (await getAutomaticOcrSetting()).enabled;
}

export async function setAutomaticOcrEnabled(enabled: boolean): Promise<AutomaticOcrSetting> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await createServerSupabase()
    .from("app_settings")
    .upsert({ key: AUTOMATIC_OCR_KEY, enabled, updated_at: updatedAt }, { onConflict: "key" })
    .select("enabled,updated_at")
    .single();

  if (error) throw error;
  return { enabled: data.enabled, updatedAt: data.updated_at };
}

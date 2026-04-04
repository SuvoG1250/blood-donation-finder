import { createClient } from "@supabase/supabase-js";

const KEYS = [
  "support_whatsapp",
  "home_tagline",
  "home_support_note",
  "emergency_retention_days",
] as const;

export type PublicSiteSettingsKey = (typeof KEYS)[number];

export async function getPublicSiteSettings(): Promise<Partial<Record<PublicSiteSettingsKey, string>>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("public_site_settings")
    .select("setting_key,setting_value")
    .in("setting_key", [...KEYS]);

  if (error || !data) return {};

  const out: Partial<Record<PublicSiteSettingsKey, string>> = {};
  for (const row of data as { setting_key: string; setting_value: string }[]) {
    if (KEYS.includes(row.setting_key as PublicSiteSettingsKey)) {
      out[row.setting_key as PublicSiteSettingsKey] = row.setting_value;
    }
  }
  return out;
}

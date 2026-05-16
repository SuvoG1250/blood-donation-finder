import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let runtimeInitPromise: Promise<SupabaseClient | null> | null = null;

function trimEnv(value: string | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function readPublicEnv() {
  const url = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey =
    trimEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    trimEnv(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readPublicEnv();
  return Boolean(url && anonKey);
}

export function getSupabaseOrNull(): SupabaseClient | null {
  if (client) return client;
  const { url, anonKey } = readPublicEnv();
  if (!url || !anonKey) return null;
  client = createClient(url, anonKey);
  return client;
}

async function fetchPublicConfig(): Promise<SupabaseClient | null> {
  const paths = ["/blood/api/public-config", "/api/public-config"];
  for (const path of paths) {
    try {
      const resp = await fetch(path, { cache: "no-store" });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { url?: string; anonKey?: string };
      const url = trimEnv(data.url);
      const anonKey = trimEnv(data.anonKey);
      if (!url || !anonKey) continue;
      client = createClient(url, anonKey);
      return client;
    } catch {
      // try next path
    }
  }
  return null;
}

/** Load Supabase from server env when NEXT_PUBLIC_* is missing in the browser bundle. */
export async function ensureSupabase(): Promise<SupabaseClient | null> {
  const existing = getSupabaseOrNull();
  if (existing) return existing;

  if (!runtimeInitPromise) {
    runtimeInitPromise = fetchPublicConfig().finally(() => {
      runtimeInitPromise = null;
    });
  }
  return runtimeInitPromise;
}

export function getSupabase(): SupabaseClient {
  const maybe = getSupabaseOrNull();
  if (!maybe) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local and restart the dev server.",
    );
  }
  return maybe;
}

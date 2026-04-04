import { getPublicSiteSettings } from "@/lib/publicSiteSettings";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Public read of marketing / support copy (no secrets). */
export async function GET() {
  try {
    const settings = await getPublicSiteSettings();
    return json({ ok: true, settings });
  } catch {
    return json({ ok: true, settings: {} });
  }
}

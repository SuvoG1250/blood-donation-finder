import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type PostEmergencyBody = {
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  patient_name: string | null;
  request_details: string;
  contact_number: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function digitsOnly(s: string) {
  return (s ?? "").replace(/[^0-9]/g, "");
}

function extractIp(req: Request): string {
  const xForwarded = req.headers.get("x-forwarded-for") ?? "";
  if (xForwarded) {
    // could be "ip1, ip2"
    return xForwarded.split(",")[0]?.trim() || "unknown";
  }
  const xReal = req.headers.get("x-real-ip") ?? "";
  if (xReal.trim()) return xReal.trim();
  return "unknown";
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars." },
      500,
    );
  }

  const body = (await req.json().catch(() => null)) as PostEmergencyBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const bloodGroup = body.blood_group?.trim();
  const district = body.district?.trim();
  const block = body.block?.trim();
  const panchayat = body.panchayat?.trim();
  const patientName = body.patient_name?.trim() || null;
  const requestDetails = (body.request_details ?? "").trim();
  const contactDigits = digitsOnly(body.contact_number);

  if (!bloodGroup) return jsonResponse({ error: "Missing blood_group" }, 400);
  if (!district) return jsonResponse({ error: "Missing district" }, 400);
  if (!block) return jsonResponse({ error: "Missing block" }, 400);
  if (!panchayat) return jsonResponse({ error: "Missing panchayat" }, 400);
  if (!requestDetails || requestDetails.length < 10) {
    return jsonResponse({ error: "Request details must be at least 10 characters." }, 400);
  }
  if (contactDigits.length < 10) {
    return jsonResponse({ error: "Contact number must be 10+ digits." }, 400);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  const ip = extractIp(req);
  const windowHours = 24;
  const limitPerIp = 3;
  const limitPerPhone = 2;

  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // Rate limit per IP (best-effort).
  const { count: ipCount } = await adminClient
    .from("emergency_requests")
    .select("request_id", { count: "exact", head: true })
    .eq("created_ip", ip)
    .gte("created_at", sinceIso);

  if (ipCount !== null && ipCount >= limitPerIp) {
    return jsonResponse(
      { error: `Rate limit exceeded. Try again later.` },
      429,
    );
  }

  // Rate limit per phone number digits.
  // (We stored contact_number as free text previously; digitsOnly makes it consistent.)
  // Note: if contact_number was entered with non-digits, older rows may not match.
  const { count: phoneCount } = await adminClient
    .from("emergency_requests")
    .select("request_id", { count: "exact", head: true })
    .eq("contact_number", contactDigits)
    .gte("created_at", sinceIso);

  if (phoneCount !== null && phoneCount >= limitPerPhone) {
    return jsonResponse(
      { error: `Too many emergency posts from this number. Try again later.` },
      429,
    );
  }

  const insertPayload = {
    blood_group: bloodGroup,
    district: district,
    block: block,
    panchayat: panchayat,
    patient_name: patientName,
    request_details: requestDetails,
    contact_number: contactDigits,
    created_ip: ip,
    status: "open",
    hospital_user_id: null,
    // created_by left null because this is a public endpoint
  };

  const { data, error } = await adminClient
    .from("emergency_requests")
    .insert(insertPayload)
    .select("request_id")
    .single();

  if (error) {
    return jsonResponse({ error: `Failed to post emergency: ${error.message}` }, 500);
  }

  return jsonResponse({ ok: true, request_id: data?.request_id });
}

Deno.serve(handler);


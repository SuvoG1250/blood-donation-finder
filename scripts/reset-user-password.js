const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  const txt = fs.readFileSync(p, "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) {
      let v = (m[2] ?? "").trim();
      if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      out[m[1]] = v;
    }
  }
  return out;
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: node scripts/reset-user-password.js <email>");
    process.exit(2);
  }

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !service) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin = createClient(url, service);

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const u = (list.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email);
  if (!u) {
    console.error("User not found:", email);
    process.exit(3);
  }

  const temp =
    "Rkt@" +
    Math.random().toString(36).slice(2, 10) +
    "#" +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  const { error: updErr } = await admin.auth.admin.updateUserById(u.id, {
    password: temp,
    ban_duration: "none",
  });
  if (updErr) throw updErr;

  await admin
    .from("profiles")
    .update({
      must_change_password: true,
      temp_password_set_at: new Date().toISOString(),
      temp_password_expires_at: null,
    })
    .eq("user_id", u.id);

  console.log("USER_ID:", u.id);
  console.log("TEMP_PASSWORD:", temp);
}

main().catch((e) => {
  console.error("Error:", e?.message ?? String(e));
  process.exit(1);
});


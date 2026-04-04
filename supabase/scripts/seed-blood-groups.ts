import process from "process";
import { createClient } from "@supabase/supabase-js";

const bloodGroups = [
  { blood_group: "O+", display_name: "O+" },
  { blood_group: "O-", display_name: "O-" },
  { blood_group: "A+", display_name: "A+" },
  { blood_group: "A-", display_name: "A-" },
  { blood_group: "B+", display_name: "B+" },
  { blood_group: "B-", display_name: "B-" },
  { blood_group: "AB+", display_name: "AB+" },
  { blood_group: "AB-", display_name: "AB-" },
];

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase.from("blood_groups").upsert(bloodGroups, {
    onConflict: "blood_group",
  });
  if (error) throw error;

  console.log("Seeded blood_groups.");
}

main().catch((err) => {
  console.error("Failed:", err?.message ?? err);
  process.exit(1);
});


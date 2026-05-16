import fs from "fs";
import path from "path";
import process from "process";
import { createClient } from "@supabase/supabase-js";

type CsvRow = {
  district: string;
  block: string;
  panchayat: string;
};

function parseCsvLine(line: string, delimiter = ",") {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur.trim());
  return out;
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    console.error(
      "Usage: ts-node import-wb-locations.ts <wb_locations.csv> (or node with compiled JS)",
    );
    console.error(
      "CSV headers must include: district, block, panchayat",
    );
    process.exit(1);
  }

  const csvPath = path.resolve(csvPathArg);
  const csvText = fs.readFileSync(csvPath, "utf8");
  const lines = csvText
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV looks empty.");
  }

  const header = parseCsvLine(lines[0], ",").map((h) => h.toLowerCase());
  const idxDistrict = header.indexOf("district");
  const idxBlock = header.indexOf("block");
  const idxPanchayat = header.indexOf("panchayat");

  if (idxDistrict < 0 || idxBlock < 0 || idxPanchayat < 0) {
    throw new Error(
      "CSV must contain headers: district, block, panchayat",
    );
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const districtCache = new Map<string, string>(); // district_name -> district_id
  const blockCache = new Map<string, string>(); // `${district_name}|||${block_name}` -> block_id

  // Batch settings: reduces round-trips.
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], ",");
    const district = normalize(cols[idxDistrict] ?? "");
    const block = normalize(cols[idxBlock] ?? "");
    const panchayat = normalize(cols[idxPanchayat] ?? "");
    if (!district || !block || !panchayat) continue;
    rows.push({ district, block, panchayat });
  }

  console.log(`Loaded ${rows.length} rows from CSV.`);

  let processed = 0;
  for (const row of rows) {
    processed++;

    // 1) District
    let districtId = districtCache.get(row.district);
    if (!districtId) {
      const { data, error } = await supabase
        .from("districts")
        .upsert(
          { district_name: row.district },
          { onConflict: "district_name" },
        )
        .select("district_id, district_name")
        .single();
      if (error) throw error;
      if (!data?.district_id) {
        throw new Error(
          `Failed to upsert district (missing district_id): ${row.district}`,
        );
      }
      const newDistrictId: string = data.district_id;
      districtId = newDistrictId;
      districtCache.set(row.district, newDistrictId);
    }

    // 2) Block
    const blockKey = `${row.district}|||${row.block}`;
    let blockId = blockCache.get(blockKey);
    if (!blockId) {
      const { data, error } = await supabase
        .from("blocks")
        .upsert(
          { district_id: districtId, block_name: row.block },
          { onConflict: "district_id,block_name" },
        )
        .select("block_id, block_name")
        .single();
      if (error) throw error;
      if (!data?.block_id) {
        throw new Error(
          `Failed to upsert block (missing block_id): ${row.district} / ${row.block}`,
        );
      }
      const newBlockId: string = data.block_id;
      blockId = newBlockId;
      blockCache.set(blockKey, newBlockId);
    }

    // 3) Panchayat
    const { error } = await supabase.from("panchayats").upsert(
      { block_id: blockId, panchayat_name: row.panchayat },
      { onConflict: "block_id,panchayat_name" },
    );
    if (error) throw error;

    if (processed % 1000 === 0) {
      console.log(`Progress: ${processed}/${rows.length}`);
    }
  }

  console.log("Import complete.");
}

main().catch((err) => {
  console.error("Import failed:", err?.message ?? err);
  process.exit(1);
});


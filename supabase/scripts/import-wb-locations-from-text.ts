import fs from "fs";
import path from "path";
import process from "process";
import { createClient } from "@supabase/supabase-js";

type LocationRow = {
  district: string;
  block: string;
  panchayat: string;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function normalizeDistrictName(raw: string) {
  // Strip things like "(Remaining Blocks)" / "(Start)".
  // Keep only the base district name.
  return raw.replace(/\s*\(.*?\)\s*/g, "").trim();
}

function parseTextLocations(text: string): LocationRow[] {
  const rows: LocationRow[] = [];

  let currentDistrict = "";
  let currentBlock = "";

  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    // Skip headers/markers
    if (line.startsWith("🚀")) continue;
    if (line.toLowerCase().includes("full list")) continue;
    if (line.toLowerCase().includes("final")) continue;

    // District lines
    // Examples:
    // "📍 District: Hooghly"
    // "District: Hooghly (Remaining Blocks)"
    const districtMatch = line.match(/(?:📍\s*)?district\s*:\s*(.+)$/i);
    if (districtMatch) {
      currentDistrict = normalizeDistrictName(districtMatch[1]);
      currentBlock = "";
      continue;
    }

    // Block lines
    // Example: "Block: Arambagh"
    const blockMatch = line.match(/block\s*:\s*(.+)$/i);
    if (blockMatch) {
      currentBlock = blockMatch[1].trim();
      continue;
    }

    // Panchayat line: only if both district + block are set.
    if (currentDistrict && currentBlock) {
      rows.push({
        district: currentDistrict,
        block: currentBlock,
        panchayat: line,
      });
    }
  }

  return rows;
}

async function main() {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error(
      "Usage: ts-node import-wb-locations-from-text.ts <wb_locations_raw.txt>",
    );
    process.exit(1);
  }

  const filePath = path.resolve(filePathArg);
  const rawText = fs.readFileSync(filePath, "utf8");

  const rows = parseTextLocations(rawText);
  if (rows.length === 0) {
    throw new Error("No rows parsed. Check the input format.");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const districtCache = new Map<string, string>(); // district_name -> district_id
  const blockCache = new Map<string, string>(); // `${district}|||${block}` -> block_id

  console.log(`Parsed ${rows.length} (district/block/panchayat) rows.`);

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
        throw new Error(`District insert failed: ${row.district}`);
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
        throw new Error(`Block insert failed: ${row.district} / ${row.block}`);
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

    if (processed % 500 === 0) {
      console.log(`Progress: ${processed}/${rows.length}`);
    }
  }

  console.log("Import complete.");
}

main().catch((err) => {
  console.error("Import failed:", err?.message ?? err);
  process.exit(1);
});


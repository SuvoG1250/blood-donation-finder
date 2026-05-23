/**
 * Builds src/data/wb-locations.json from:
 * - supabase/scripts/wb_locations_raw.txt (district / block / panchayat)
 * - india-pincode package (all West Bengal post offices)
 *
 * Run: node scripts/build-wb-locations.cjs
 */

const fs = require("fs");
const path = require("path");
const { getIndiaPincode } = require("india-pincode");

const ROOT = path.join(__dirname, "..");
const RAW_PATH = path.join(ROOT, "supabase/scripts/wb_locations_raw.txt");
const OUT_PATH = path.join(ROOT, "src/data/wb-locations.json");

/** india-pincode district name → project district name */
const DISTRICT_ALIASES = {
  "24 PARAGANAS NORTH": "North 24 Parganas",
  "24 PARAGANAS SOUTH": "South 24 Parganas",
  HOOGHLY: "Hooghly",
  MALDAH: "Malda",
  "MEDINIPUR EAST": "Purba Medinipur",
  "MEDINIPUR WEST": "Paschim Medinipur",
  "DINAJPUR DAKSHIN": "Dakshin Dinajpur",
  "DINAJPUR UTTAR": "Uttar Dinajpur",
  COOCHBEHAR: "Cooch Behar",
  BIRBHUM: "Birbhum",
  BANKURA: "Bankura",
  HOWRAH: "Howrah",
  JALPAIGURI: "Jalpaiguri",
  KALIMPONG: "Kalimpong",
  DARJEELING: "Darjeeling",
  PURULIA: "Purulia",
  NADIA: "Nadia",
  MURSHIDABAD: "Murshidabad",
  "PURBA BARDHAMAN": "Purba Bardhaman",
  "PASCHIM BARDHAMAN": "Paschim Bardhaman",
  Jhargram: "Jhargram",
  Alipurduar: "Alipurduar",
  KOLKATA: "Kolkata",
};

/** Verified locality → block (extend as needed). */
const MANUAL_LOCALITY_BLOCKS = [
  { district: "Hooghly", locality: "Chuadanga", block: "Khanakul I" },
  { district: "Hooghly", locality: "Daharkunda", block: "Khanakul I" },
  { district: "Hooghly", locality: "Gujrat", block: "Khanakul I" },
  { district: "Hooghly", locality: "Mayalbandipur", block: "Khanakul I" },
  { district: "Hooghly", locality: "Kishorepur", block: "Khanakul I" },
  { district: "Hooghly", locality: "Mahisgot", block: "Arambagh" },
  { district: "Hooghly", locality: "Manikpat", block: "Arambagh" },
  { district: "Hooghly", locality: "Baradangal", block: "Arambagh" },
];

/** Blocks listed under wrong district in raw text — reassign on import. */
const RAW_BLOCK_DISTRICT_FIX = {
  Berhampore: "Murshidabad",
  Kandi: "Murshidabad",
  Domkal: "Murshidabad",
  Jalangi: "Murshidabad",
  "Raninagar I": "Murshidabad",
  "Raninagar II": "Murshidabad",
};

/** Extra admin blocks for districts missing from raw (subset; offices still added by locality match). */
const EXTRA_DISTRICT_BLOCKS = {
  Murshidabad: [
    "Berhampore",
    "Beldanga I",
    "Beldanga II",
    "Hariharpara",
    "Naoda",
    "Kandi",
    "Khagra",
    "Burwan",
    "Bharatpur I",
    "Bharatpur II",
    "Rejinagar",
    "Jalangi",
    "Lalgola",
    "Bhagawangola I",
    "Bhagawangola II",
    "Raninagar I",
    "Raninagar II",
    "Domkal",
    "Nawda",
    "Suti I",
    "Suti II",
    "Samserganj",
    "Farakka",
    "Raghunathganj I",
    "Raghunathganj II",
    "Sagardighi",
  ],
  Jhargram: [
    "Jhargram",
    "Binpur I",
    "Binpur II",
    "Gopiballavpur I",
    "Gopiballavpur II",
    "Jamboni",
    "Nayagram",
    "Sankrail",
  ],
  "Purba Bardhaman": [
    "Kalna I",
    "Kalna II",
    "Katwa I",
    "Katwa II",
    "Manteswar",
    "Purbasthali I",
    "Purbasthali II",
    "Bhagabanpur",
    "Burdwan I",
    "Burdwan II",
    "Ausgram I",
    "Ausgram II",
    "Galsi I",
    "Galsi II",
  ],
  "Paschim Bardhaman": [
    "Asansol",
    "Durgapur",
    "Kanksa",
    "Pandabeswar",
    "Faridpur",
    "Barabani",
    "Salanpur",
    "Raniganj",
    "Jamuria",
    "Ondal",
  ],
  Kolkata: ["Kolkata North", "Kolkata South", "Kolkata East", "Kolkata West"],
};

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function titleCaseWords(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeDistrictName(raw) {
  const cleaned = String(raw ?? "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();
  const upper = cleaned.toUpperCase();
  return DISTRICT_ALIASES[upper] ?? DISTRICT_ALIASES[cleaned] ?? titleCaseWords(cleaned);
}

function parseRawLocations(text) {
  const rows = [];
  let currentDistrict = "";
  let currentBlock = "";

  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("🚀")) continue;
    if (trimmed.toLowerCase().includes("full list")) continue;

    const districtMatch = trimmed.match(/(?:📍\s*)?district\s*:\s*(.+)$/i);
    if (districtMatch) {
      currentDistrict = normalizeDistrictName(districtMatch[1]);
      currentBlock = "";
      continue;
    }

    const blockMatch = trimmed.match(/block\s*:\s*(.+)$/i);
    if (blockMatch) {
      const blockName = blockMatch[1].trim();
      currentBlock = blockName;
      if (RAW_BLOCK_DISTRICT_FIX[blockName]) {
        currentDistrict = RAW_BLOCK_DISTRICT_FIX[blockName];
      }
      continue;
    }

    if (currentDistrict && currentBlock) {
      rows.push({
        district: currentDistrict,
        block: currentBlock,
        panchayat: trimmed,
      });
    }
  }

  return rows;
}

function buildDistrictTree(rawRows) {
  const districtMap = new Map();

  function ensureDistrict(name) {
    if (!districtMap.has(name)) {
      districtMap.set(name, { district: name, blocks: new Map() });
    }
    return districtMap.get(name);
  }

  function ensureBlock(districtName, blockName) {
    const d = ensureDistrict(districtName);
    if (!d.blocks.has(blockName)) {
      d.blocks.set(blockName, { block: blockName, areas: new Set() });
    }
    return d.blocks.get(blockName);
  }

  for (const row of rawRows) {
    ensureBlock(row.district, row.block).areas.add(row.panchayat);
  }

  for (const [districtName, blocks] of Object.entries(EXTRA_DISTRICT_BLOCKS)) {
    for (const blockName of blocks) {
      ensureBlock(districtName, blockName);
    }
  }

  return districtMap;
}

function districtToExport(districtMap) {
  return [...districtMap.values()]
    .map((d) => ({
      district: d.district,
      blocks: [...d.blocks.values()]
        .map((b) => ({
          block: b.block,
          areas: [...b.areas].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.block.localeCompare(b.block)),
    }))
    .sort((a, b) => a.district.localeCompare(b.district));
}

function findDistrictEntry(districtMap, districtName) {
  return districtMap.get(districtName);
}

function matchAreaToBlockInDistrict(districtEntry, locality) {
  if (!districtEntry) return null;
  const key = normalizeKey(locality);
  if (!key) return null;

  for (const { block, areas } of districtEntry.blocks.values()) {
    const blockKey = normalizeKey(block);
    if (key === blockKey || key.includes(blockKey) || blockKey.includes(key)) {
      return block;
    }
    for (const area of areas) {
      const areaKey = normalizeKey(area);
      if (key === areaKey || key.includes(areaKey) || areaKey.includes(key)) {
        return block;
      }
    }
  }

  for (const blockName of districtEntry.blocks.keys()) {
    const blockKey = normalizeKey(blockName);
    if (key.includes(blockKey) || blockKey.includes(key)) {
      return blockName;
    }
  }

  return null;
}

function matchAreaToBlockByName(locality, blockNames) {
  const key = normalizeKey(locality);
  if (!key) return null;
  for (const blockName of blockNames) {
    const blockKey = normalizeKey(blockName);
    if (key === blockKey || key.includes(blockKey) || blockKey.includes(key)) {
      return blockName;
    }
  }
  return null;
}

function addAreaToBlock(districtMap, districtName, blockName, areaName) {
  if (!districtName || !blockName || !areaName) return;
  const d = districtMap.get(districtName) ?? {
    district: districtName,
    blocks: new Map(),
  };
  if (!districtMap.has(districtName)) districtMap.set(districtName, d);

  if (!d.blocks.has(blockName)) {
    d.blocks.set(blockName, { block: blockName, areas: new Set() });
  }
  d.blocks.get(blockName).areas.add(areaName.trim());
}

function main() {
  const rawText = fs.readFileSync(RAW_PATH, "utf8");
  const rawRows = parseRawLocations(rawText);
  const districtMap = buildDistrictTree(rawRows);

  const pin = getIndiaPincode();
  const wbOffices = pin.getByState("WEST BENGAL", { limit: 200_000 });
  if (!wbOffices.success || !wbOffices.data?.data?.length) {
    throw new Error("Failed to load West Bengal offices from india-pincode");
  }

  const offices = wbOffices.data.data;
  const assignments = [];
  const allBlockNames = new Set();
  for (const d of districtMap.values()) {
    for (const b of d.blocks.keys()) allBlockNames.add(b);
  }

  for (const office of offices) {
    const district = normalizeDistrictName(office.district);
    const locality = String(office.area ?? "").trim();
    const pincode = String(office.pincode ?? "").trim();
    if (!district || !locality) continue;

    let block = null;

    const manual = MANUAL_LOCALITY_BLOCKS.find(
      (m) =>
        normalizeKey(m.district) === normalizeKey(district) &&
        normalizeKey(m.locality) === normalizeKey(locality),
    );
    if (manual) block = manual.block;

    if (!block) {
      block = matchAreaToBlockInDistrict(findDistrictEntry(districtMap, district), locality);
    }

    if (!block && EXTRA_DISTRICT_BLOCKS[district]) {
      block = matchAreaToBlockByName(locality, EXTRA_DISTRICT_BLOCKS[district]);
    }

    if (!block) {
      block = matchAreaToBlockByName(locality, [...allBlockNames]);
    }

    assignments.push({ district, block: block ?? "", locality, pincode });
  }

  // Pincode consensus: if most offices on a PIN share a block, apply to the rest in that PIN.
  const byPin = new Map();
  for (const a of assignments) {
    if (!a.pincode || !a.district) continue;
    const k = `${a.pincode}|${normalizeKey(a.district)}`;
    if (!byPin.has(k)) byPin.set(k, []);
    byPin.get(k).push(a);
  }

  for (const group of byPin.values()) {
    const counts = new Map();
    for (const a of group) {
      if (!a.block) continue;
      counts.set(a.block, (counts.get(a.block) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (counts.get(best) < 2 && group.length > 3) continue;
    for (const a of group) {
      if (!a.block) a.block = best;
    }
  }

  for (const a of assignments) {
    if (a.block) {
      addAreaToBlock(districtMap, a.district, a.block, a.locality);
    }
  }

  const districts = districtToExport(districtMap);
  const localityByKey = {};
  const pincodeByDigits = {};

  for (const a of assignments) {
    const district = a.district;
    const panchayat = a.locality;
    const block = a.block || matchAreaToBlockInDistrict(findDistrictEntry(districtMap, district), panchayat) || "";

    const locKey = `${normalizeKey(district)}|${normalizeKey(panchayat)}`;
    if (block && !localityByKey[locKey]) {
      localityByKey[locKey] = { district, block, panchayat };
    }

    if (!a.pincode) continue;
    if (!pincodeByDigits[a.pincode]) pincodeByDigits[a.pincode] = [];
    pincodeByDigits[a.pincode].push({
      district,
      block,
      panchayat,
    });
  }

  // Dedupe pincode entries
  for (const pin of Object.keys(pincodeByDigits)) {
    const seen = new Set();
    pincodeByDigits[pin] = pincodeByDigits[pin].filter((row) => {
      const k = `${row.district}|${row.block}|${row.panchayat}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    stats: {
      districts: districts.length,
      postOffices: offices.length,
      localityKeys: Object.keys(localityByKey).length,
      pincodes: Object.keys(pincodeByDigits).length,
    },
    districts,
    localityByKey,
    pincodeByDigits,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log("Wrote", OUT_PATH);
  console.log(JSON.stringify(payload.stats, null, 2));
}

main();

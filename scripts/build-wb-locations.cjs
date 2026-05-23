/**
 * Builds src/data/wb-locations.json from:
 * - Official WB districts (igod.gov.in)
 * - WB JJM household survey village list (district / block / GP / village)
 * - india-pincode (post office names + PIN codes)
 *
 * Run: node scripts/build-wb-locations.cjs
 */

const fs = require("fs");
const path = require("path");
const { getIndiaPincode } = require("india-pincode");

const ROOT = path.join(__dirname, "..");
const JJM_PATH = path.join(__dirname, "data/wb-jjm-villages.tsv");
const OFFICIAL_PATH = path.join(ROOT, "src/data/official-wb-districts.json");
const OUT_PATH = path.join(ROOT, "src/data/wb-locations.json");

const officialWb = JSON.parse(fs.readFileSync(OFFICIAL_PATH, "utf8"));
const OFFICIAL_DISTRICTS = officialWb.districts;

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const OFFICIAL_KEYS = new Map(
  OFFICIAL_DISTRICTS.map((d) => [normalizeKey(d), d]),
);

const DISTRICT_ALIASES = {
  "24paraganasnorth": "North 24 Parganas",
  "24paraganassouth": "South 24 Parganas",
  north24parganas: "North 24 Parganas",
  south24parganas: "South 24 Parganas",
  hooghly: "Hooghly",
  maldah: "Malda",
  medinipureast: "Purba Medinipur",
  medinipurwest: "Paschim Medinipur",
  purbamedinipur: "Purba Medinipur",
  paschimmedinipur: "Paschim Medinipur",
  dinajpurdakshin: "Dakshin Dinajpur",
  dinajpuruttar: "Uttar Dinajpur",
  dakshindinajpur: "Dakshin Dinajpur",
  uttardinajpur: "Uttar Dinajpur",
  coochbehar: "Cooch Behar",
  birbhum: "Birbhum",
  bankura: "Bankura",
  howrah: "Howrah",
  jalpaiguri: "Jalpaiguri",
  kalimpong: "Kalimpong",
  darjeeling: "Darjeeling",
  purulia: "Purulia",
  nadia: "Nadia",
  murshidabad: "Murshidabad",
  purbabardhaman: "Purba Bardhaman",
  paschimbardhaman: "Paschim Bardhaman",
  jhargram: "Jhargram",
  alipurduar: "Alipurduar",
  kolkata: "Kolkata",
};

const BLOCK_ALIASES = {
  arambag: "Arambagh",
  arambagh: "Arambagh",
};

function normalizeOfficialDistrict(raw) {
  const key = normalizeKey(raw);
  if (!key) return "";
  if (OFFICIAL_KEYS.has(key)) return OFFICIAL_KEYS.get(key);
  if (DISTRICT_ALIASES[key]) return DISTRICT_ALIASES[key];
  for (const [aliasKey, name] of Object.entries(DISTRICT_ALIASES)) {
    if (key.includes(aliasKey) || aliasKey.includes(key)) return name;
  }
  for (const [officialKey, name] of OFFICIAL_KEYS) {
    if (key.includes(officialKey) || officialKey.includes(key)) return name;
  }
  return "";
}

function titleCaseWords(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** "Khanakul - I" → "Khanakul I", "Arambag" → "Arambagh" */
function normalizeBlockName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const collapsed = trimmed.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
  const key = normalizeKey(collapsed);
  if (BLOCK_ALIASES[key]) return BLOCK_ALIASES[key];
  return titleCaseWords(collapsed);
}

/** Strip census suffixes: "Abad Bhagabanpur (79)" → "Abad Bhagabanpur" */
function cleanPlaceName(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+B\.?O\.?$/i, "")
    .replace(/\s+S\.?O\.?$/i, "")
    .replace(/\s+H\.?O\.?$/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPanchayatName(raw) {
  const s = cleanPlaceName(raw);
  if (!s) return "";
  return titleCaseWords(s.replace(/-/g, " "));
}

/** Verified post office / village → admin block (PIN 712617 and similar). */
const MANUAL_LOCALITY_BLOCKS = [
  { district: "Hooghly", locality: "Chuadanga", block: "Khanakul I" },
  { district: "Hooghly", locality: "Mahisgot", block: "Khanakul I" },
  { district: "Hooghly", locality: "Gujrat", block: "Khanakul I" },
  { district: "Hooghly", locality: "Mayalbandipur", block: "Khanakul I" },
  { district: "Hooghly", locality: "Kishorepur", block: "Khanakul I" },
  { district: "Hooghly", locality: "Niranjanbati", block: "Khanakul I" },
  { district: "Hooghly", locality: "Daharkunda", block: "Arambagh" },
  { district: "Hooghly", locality: "Manikpat", block: "Arambagh" },
  { district: "Hooghly", locality: "Baradangal", block: "Arambagh" },
  { district: "Hooghly", locality: "Baradongal", block: "Arambagh" },
  { district: "Hooghly", locality: "Bara Dongal", block: "Arambagh" },
  { district: "Hooghly", locality: "Atapur", block: "Arambagh" },
  { district: "Hooghly", locality: "Basantabati", block: "Arambagh" },
  { district: "Hooghly", locality: "Berabere", block: "Arambagh" },
];

/** Villages under a PIN that are not separate India Post offices (merged into lookup). */
const MANUAL_PINCODE_LOCALITIES = [
  {
    pincode: "712617",
    district: "Hooghly",
    locality: "Atapur",
    block: "Arambagh",
    village: "Atapur",
  },
  {
    pincode: "712617",
    district: "Hooghly",
    locality: "Basantabati",
    block: "Arambagh",
    village: "Basantabati",
  },
  {
    pincode: "712617",
    district: "Hooghly",
    locality: "Baradongal",
    block: "Arambagh",
    village: "Bara Dongal",
  },
  {
    pincode: "712617",
    district: "Hooghly",
    locality: "Berabere",
    block: "Arambagh",
    village: "Berabere",
  },
  {
    pincode: "712617",
    district: "Hooghly",
    locality: "Niranjanbati",
    block: "Khanakul I",
    village: "Niranjanbati",
  },
];

function parseJjmVillages(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("|Sl")) continue;
    const parts = trimmed.split("|").filter((p) => p !== "");
    if (parts.length < 5) continue;

    const district = normalizeOfficialDistrict(parts[1]);
    const block = normalizeBlockName(parts[2]);
    const panchayat = cleanPanchayatName(parts[3]);
    const village = cleanPlaceName(parts[4]);
    if (!district || !block || !village) continue;

    rows.push({ district, block, panchayat, village });
  }
  return rows;
}

function buildDistrictTree(jjmRows) {
  const districtMap = new Map();

  for (const name of OFFICIAL_DISTRICTS) {
    districtMap.set(name, { district: name, blocks: new Map() });
  }

  function ensureBlock(districtName, blockName) {
    const d = districtMap.get(districtName);
    if (!d) return null;
    if (!d.blocks.has(blockName)) {
      d.blocks.set(blockName, {
        block: blockName,
        panchayats: new Map(),
      });
    }
    return d.blocks.get(blockName);
  }

  function ensurePanchayat(blockEntry, panchayatName) {
    const key = panchayatName || "__unassigned__";
    if (!blockEntry.panchayats.has(key)) {
      blockEntry.panchayats.set(key, {
        panchayat: panchayatName,
        villages: new Set(),
      });
    }
    return blockEntry.panchayats.get(key);
  }

  for (const row of jjmRows) {
    if (!districtMap.has(row.district)) continue;
    const blockEntry = ensureBlock(row.district, row.block);
    if (!blockEntry) continue;
    const pEntry = ensurePanchayat(blockEntry, row.panchayat);
    pEntry.villages.add(row.village);
  }

  return districtMap;
}

function districtToExport(districtMap) {
  return OFFICIAL_DISTRICTS.map((name) => {
    const d = districtMap.get(name);
    const blocks = d ? [...d.blocks.values()] : [];
    return {
      district: name,
      blocks: blocks
        .map((b) => ({
          block: b.block,
          panchayats: [...b.panchayats.values()]
            .map((p) => ({
              panchayat: p.panchayat,
              villages: [...p.villages].sort((a, b) => a.localeCompare(b)),
            }))
            .sort((a, b) =>
              (a.panchayat || "").localeCompare(b.panchayat || ""),
            ),
          areas: [...b.panchayats.values()].flatMap((p) => [
            ...(p.panchayat ? [p.panchayat] : []),
            ...p.villages,
          ]),
        }))
        .sort((a, b) => a.block.localeCompare(b.block)),
    };
  });
}

function buildLookupIndexes(jjmRows) {
  /** districtKey -> { byVillage, byPanchayat } */
  const byDistrict = new Map();

  function districtIndex(district) {
    const key = normalizeKey(district);
    if (!byDistrict.has(key)) {
      byDistrict.set(key, {
        byVillage: new Map(),
        byPanchayat: new Map(),
      });
    }
    return byDistrict.get(key);
  }

  function addRecord(map, nameKey, record) {
    if (!nameKey) return;
    if (!map.has(nameKey)) map.set(nameKey, record);
  }

  for (const row of jjmRows) {
    const idx = districtIndex(row.district);
    const record = {
      district: row.district,
      block: row.block,
      panchayat: row.panchayat,
      village: row.village,
    };

    const villageKey = normalizeKey(row.village);
    const panchayatKey = normalizeKey(row.panchayat);

    addRecord(idx.byVillage, villageKey, record);
    if (panchayatKey) addRecord(idx.byPanchayat, panchayatKey, record);

    const villageWords = row.village.split(/\s+/).filter((w) => w.length >= 4);
    for (const w of villageWords) {
      addRecord(idx.byVillage, normalizeKey(w), record);
    }
  }

  return byDistrict;
}

function fuzzyFindInMap(map, localityKey) {
  if (map.has(localityKey)) return map.get(localityKey);

  for (const [key, record] of map) {
    if (key.length < 4 || localityKey.length < 4) continue;
    if (localityKey.includes(key) || key.includes(localityKey)) return record;
  }
  return null;
}

function resolveLocality(district, locality, lookupIndexes) {
  const districtKey = normalizeKey(district);
  const localityKey = normalizeKey(cleanPlaceName(locality));
  if (!districtKey || !localityKey) return null;

  const manual = MANUAL_LOCALITY_BLOCKS.find(
    (m) =>
      normalizeKey(m.district) === districtKey &&
      normalizeKey(m.locality) === localityKey,
  );
  if (manual) {
    return {
      district,
      block: manual.block,
      panchayat: cleanPlaceName(locality),
      village: "",
    };
  }

  const idx = lookupIndexes.get(districtKey);
  if (!idx) return null;

  const fromVillage =
    idx.byVillage.get(localityKey) ?? fuzzyFindInMap(idx.byVillage, localityKey);
  if (fromVillage) return fromVillage;

  const fromPanchayat =
    idx.byPanchayat.get(localityKey) ??
    fuzzyFindInMap(idx.byPanchayat, localityKey);
  if (fromPanchayat) return fromPanchayat;

  return null;
}

function main() {
  if (!fs.existsSync(JJM_PATH)) {
    throw new Error(
      `Missing ${JJM_PATH}. Copy WB JJM village export (see scripts/data/README.md).`,
    );
  }

  const jjmText = fs.readFileSync(JJM_PATH, "utf8");
  const jjmRows = parseJjmVillages(jjmText);
  const districtMap = buildDistrictTree(jjmRows);
  const lookupIndexes = buildLookupIndexes(jjmRows);

  const pin = getIndiaPincode();
  const wbOffices = pin.getByState("WEST BENGAL", { limit: 200_000 });
  if (!wbOffices.success || !wbOffices.data?.data?.length) {
    throw new Error("Failed to load West Bengal offices from india-pincode");
  }

  const offices = wbOffices.data.data;
  const assignments = [];

  for (const office of offices) {
    const district = normalizeOfficialDistrict(office.district);
    const locality = cleanPlaceName(office.area ?? "");
    const pincode = String(office.pincode ?? "").trim();
    if (!district || !locality) continue;

    const resolved = resolveLocality(district, locality, lookupIndexes);
    const block = resolved?.block ?? "";
    const panchayat = resolved?.panchayat || locality;
    const village =
      resolved?.village &&
      normalizeKey(resolved.village) !== normalizeKey(locality)
        ? resolved.village
        : resolved?.village || "";

    assignments.push({
      district,
      block,
      locality,
      panchayat,
      village,
      pincode,
    });
  }

  const districts = districtToExport(districtMap);
  const localityByKey = {};
  const pincodeByDigits = {};

  for (const a of assignments) {
    const locKey = `${normalizeKey(a.district)}|${normalizeKey(a.locality)}`;
    if (a.block && !localityByKey[locKey]) {
      localityByKey[locKey] = {
        district: a.district,
        block: a.block,
        panchayat: a.panchayat,
        village: a.village,
      };
    }

    if (!a.pincode) continue;
    if (!pincodeByDigits[a.pincode]) pincodeByDigits[a.pincode] = [];
    pincodeByDigits[a.pincode].push({
      district: a.district,
      block: a.block,
      panchayat: a.panchayat || a.locality,
      village: a.village,
    });
  }

  for (const extra of MANUAL_PINCODE_LOCALITIES) {
    const pin = extra.pincode;
    const locality = extra.locality;
    const locKey = `${normalizeKey(extra.district)}|${normalizeKey(locality)}`;
    if (!localityByKey[locKey]) {
      localityByKey[locKey] = {
        district: extra.district,
        block: extra.block,
        panchayat: locality,
        village: extra.village || locality,
      };
    }
    if (!pincodeByDigits[pin]) pincodeByDigits[pin] = [];
    const exists = pincodeByDigits[pin].some(
      (row) =>
        normalizeKey(row.panchayat) === normalizeKey(locality) ||
        normalizeKey(row.village) === normalizeKey(extra.village || locality),
    );
    if (!exists) {
      pincodeByDigits[pin].push({
        district: extra.district,
        block: extra.block,
        panchayat: locality,
        village: extra.village || locality,
      });
    }
  }

  for (const pin of Object.keys(pincodeByDigits)) {
    const seen = new Set();
    pincodeByDigits[pin] = pincodeByDigits[pin].filter((row) => {
      const k = `${row.district}|${row.block}|${row.panchayat}|${row.village}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const withBlock = assignments.filter((a) => a.block).length;
  const uniqueBlocks = new Set(
    jjmRows.map((r) => `${r.district}|${r.block}`),
  ).size;
  const uniquePanchayats = new Set(
    jjmRows.filter((r) => r.panchayat).map((r) => `${r.district}|${r.panchayat}`),
  ).size;

  const payload = {
    version: 4,
    generatedAt: new Date().toISOString(),
    sources: {
      districts:
        "https://github.com/KTBsomen/Indian-state-district-json (igod.gov.in)",
      villages:
        "WB Jal Jeevan Mission household survey (jjm.wbphed.gov.in) — district/block/GP/village",
      postOffices: "india-pincode npm package",
    },
    stats: {
      officialDistricts: OFFICIAL_DISTRICTS.length,
      jjmVillages: jjmRows.length,
      uniqueBlocks,
      uniquePanchayats,
      postOffices: offices.length,
      assignmentsWithBlock: withBlock,
      blockCoveragePct: Math.round((withBlock / offices.length) * 1000) / 10,
      localityKeys: Object.keys(localityByKey).length,
      pincodes: Object.keys(pincodeByDigits).length,
    },
    officialDistricts: OFFICIAL_DISTRICTS,
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

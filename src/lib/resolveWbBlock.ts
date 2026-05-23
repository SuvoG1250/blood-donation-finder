import { WB_DISTRICTS } from "@/lib/wbLocations";

/** Normalize for fuzzy district / locality matching. */
export function normalizeLocationKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findDistrict(districtName: string) {
  const key = normalizeLocationKey(districtName);
  if (!key) return undefined;
  return WB_DISTRICTS.find((d) => normalizeLocationKey(d.district) === key);
}

/** Taluk / subdivision hints from postal data → WB admin block name. */
const TALUK_BLOCK_ALIASES: Record<string, string> = {
  arambag: "Arambagh",
  arambagh: "Arambagh",
  khanakuli: "Khanakul I",
  khanakul: "Khanakul I",
  khanakulii: "Khanakul II",
  khanakul2: "Khanakul II",
  pandua: "Pandua",
  singur: "Singur",
  chinsurah: "Chinsurah",
  serampore: "Sreerampur",
  sreerampur: "Sreerampur",
  tarakeswar: "Tarakeswar",
  pursurah: "Pursurah",
  dhaniakhali: "Dhaniakhali",
  polbadadpur: "Polba-Dadpur",
  goghat: "Goghat I",
  balagarh: "Balagarh",
};

function blockExistsInDistrict(districtName: string, blockName: string): boolean {
  const district = findDistrict(districtName);
  if (!district) return false;
  const key = normalizeLocationKey(blockName);
  return district.blocks.some((b) => normalizeLocationKey(b.block) === key);
}

function matchLocalityToBlock(
  districtName: string,
  locality: string,
): string | null {
  const district = findDistrict(districtName);
  if (!district) return null;

  const localityKey = normalizeLocationKey(locality);
  if (!localityKey) return null;

  for (const { block, areas } of district.blocks) {
    const blockKey = normalizeLocationKey(block);
    if (localityKey === blockKey || localityKey.includes(blockKey) || blockKey.includes(localityKey)) {
      return block;
    }
    for (const area of areas) {
      const areaKey = normalizeLocationKey(area);
      if (!areaKey) continue;
      if (
        localityKey === areaKey ||
        localityKey.includes(areaKey) ||
        areaKey.includes(localityKey)
      ) {
        return block;
      }
    }
  }

  return null;
}

function matchTalukHint(
  districtName: string,
  talukOrDivision: string,
): string | null {
  const raw = talukOrDivision.trim();
  if (!raw) return null;

  const key = normalizeLocationKey(raw.replace(/\s+Division$/i, ""));
  const alias = TALUK_BLOCK_ALIASES[key];
  if (alias && blockExistsInDistrict(districtName, alias)) return alias;

  for (const [hintKey, blockName] of Object.entries(TALUK_BLOCK_ALIASES)) {
    if (key.includes(hintKey) && blockExistsInDistrict(districtName, blockName)) {
      return blockName;
    }
  }

  return null;
}

/**
 * Resolve West Bengal administrative block from district + post office / locality name.
 * Never returns the district name as block.
 */
export function resolveWbBlock(
  districtName: string,
  localityName: string,
  hints?: { taluk?: string; division?: string; postalBlock?: string },
): string {
  const district = districtName.trim();
  const locality = localityName.trim();
  const districtKey = normalizeLocationKey(district);

  const postalBlock = (hints?.postalBlock ?? "").trim();
  if (postalBlock && normalizeLocationKey(postalBlock) !== districtKey) {
    if (blockExistsInDistrict(district, postalBlock)) return postalBlock;
  }

  const fromLocality = matchLocalityToBlock(district, locality);
  if (fromLocality) return fromLocality;

  for (const hint of [hints?.taluk, hints?.division]) {
    if (!hint) continue;
    const fromTaluk = matchTalukHint(district, hint);
    if (fromTaluk) return fromTaluk;
  }

  return "";
}

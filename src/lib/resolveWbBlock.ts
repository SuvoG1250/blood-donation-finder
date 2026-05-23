import {
  WB_DISTRICTS,
  WB_LOCALITY_INDEX,
  WB_PINCODE_INDEX,
} from "@/lib/wbLocations";
import { normalizeLocationKey } from "@/lib/locationKeys";

export { normalizeLocationKey } from "@/lib/locationKeys";

function findDistrict(districtName: string) {
  const key = normalizeLocationKey(districtName);
  if (!key) return undefined;
  return WB_DISTRICTS.find((d) => normalizeLocationKey(d.district) === key);
}

function blockExistsInDistrict(districtName: string, blockName: string): boolean {
  const district = findDistrict(districtName);
  if (!district) return false;
  const key = normalizeLocationKey(blockName);
  return district.blocks.some((b) => normalizeLocationKey(b.block) === key);
}

function matchLocalityToBlock(districtName: string, locality: string): string | null {
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

function lookupIndexed(
  districtName: string,
  localityName: string,
  pincode?: string,
): string {
  const districtKey = normalizeLocationKey(districtName);
  const localityKey = normalizeLocationKey(localityName);
  const locKey = `${districtKey}|${localityKey}`;
  const indexed = WB_LOCALITY_INDEX[locKey];
  if (indexed?.block) return indexed.block;

  const digits = (pincode ?? "").replace(/\D/g, "");
  if (digits.length === 6) {
    const offices = WB_PINCODE_INDEX[digits] ?? [];
    const districtMatch = offices.filter(
      (o) => normalizeLocationKey(o.district) === districtKey,
    );
    const exact = districtMatch.find(
      (o) => normalizeLocationKey(o.panchayat) === localityKey && o.block,
    );
    if (exact?.block) return exact.block;

    const counts = new Map<string, number>();
    for (const o of districtMatch) {
      if (!o.block) continue;
      counts.set(o.block, (counts.get(o.block) ?? 0) + 1);
    }
    if (counts.size > 0) {
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best[1] >= 1) return best[0];
    }
  }

  return "";
}

/**
 * Resolve West Bengal administrative block from district + post office / locality name.
 * Never returns the district name as block.
 */
export function resolveWbBlock(
  districtName: string,
  localityName: string,
  hints?: { taluk?: string; division?: string; postalBlock?: string; pincode?: string },
): string {
  const district = districtName.trim();
  const locality = localityName.trim();
  const districtKey = normalizeLocationKey(district);

  const postalBlock = (hints?.postalBlock ?? "").trim();
  if (postalBlock && normalizeLocationKey(postalBlock) !== districtKey) {
    if (blockExistsInDistrict(district, postalBlock)) return postalBlock;
  }

  const fromIndex = lookupIndexed(district, locality, hints?.pincode);
  if (fromIndex) return fromIndex;

  const fromLocality = matchLocalityToBlock(district, locality);
  if (fromLocality) return fromLocality;

  return "";
}

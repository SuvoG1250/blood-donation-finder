import {
  WB_DISTRICTS,
  WB_LOCALITY_INDEX,
  WB_PINCODE_INDEX,
  type WbLocalityIndexEntry,
} from "@/lib/wbLocations";
import { normalizeLocationKey } from "@/lib/locationKeys";

export { normalizeLocationKey } from "@/lib/locationKeys";

export type WbResolvedLocation = {
  block: string;
  panchayat: string;
  village: string;
};

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

function matchLocalityInDistrict(
  districtName: string,
  locality: string,
): WbLocalityIndexEntry | null {
  const district = findDistrict(districtName);
  if (!district) return null;

  const localityKey = normalizeLocationKey(locality);
  if (!localityKey) return null;

  for (const { block, areas, panchayats } of district.blocks) {
    if (panchayats) {
      for (const p of panchayats) {
        const pKey = normalizeLocationKey(p.panchayat);
        if (pKey && (localityKey === pKey || localityKey.includes(pKey) || pKey.includes(localityKey))) {
          return { district: districtName, block, panchayat: p.panchayat, village: "" };
        }
        for (const v of p.villages) {
          const vKey = normalizeLocationKey(v);
          if (!vKey) continue;
          if (localityKey === vKey || localityKey.includes(vKey) || vKey.includes(localityKey)) {
            return {
              district: districtName,
              block,
              panchayat: p.panchayat,
              village: v,
            };
          }
        }
      }
    }

    for (const area of areas) {
      const areaKey = normalizeLocationKey(area);
      if (!areaKey) continue;
      if (localityKey === areaKey || localityKey.includes(areaKey) || areaKey.includes(localityKey)) {
        return { district: districtName, block, panchayat: area, village: "" };
      }
    }
  }

  return null;
}

function lookupIndexed(
  districtName: string,
  localityName: string,
  pincode?: string,
): WbLocalityIndexEntry | null {
  const districtKey = normalizeLocationKey(districtName);
  const localityKey = normalizeLocationKey(localityName);
  const locKey = `${districtKey}|${localityKey}`;
  const indexed = WB_LOCALITY_INDEX[locKey];
  if (indexed?.block) return indexed;

  const digits = (pincode ?? "").replace(/\D/g, "");
  if (digits.length === 6) {
    const offices = WB_PINCODE_INDEX[digits] ?? [];
    const exact = offices.find(
      (o) =>
        normalizeLocationKey(o.district) === districtKey &&
        normalizeLocationKey(o.panchayat) === localityKey &&
        o.block,
    );
    if (exact?.block) return exact;
  }

  return null;
}

/**
 * Resolve West Bengal block, panchayat, and village from district + post office / locality.
 */
export function resolveWbLocation(
  districtName: string,
  localityName: string,
  hints?: { taluk?: string; division?: string; postalBlock?: string; pincode?: string },
): WbResolvedLocation {
  const district = districtName.trim();
  const locality = localityName.trim();
  const districtKey = normalizeLocationKey(district);
  const empty: WbResolvedLocation = { block: "", panchayat: locality, village: "" };

  const postalBlock = (hints?.postalBlock ?? "").trim();
  if (postalBlock && normalizeLocationKey(postalBlock) !== districtKey) {
    if (blockExistsInDistrict(district, postalBlock)) {
      return { block: postalBlock, panchayat: locality, village: "" };
    }
  }

  const fromIndex = lookupIndexed(district, locality, hints?.pincode);
  if (fromIndex?.block) {
    return {
      block: fromIndex.block,
      panchayat: fromIndex.panchayat || locality,
      village: fromIndex.village ?? "",
    };
  }

  const fromTree = matchLocalityInDistrict(district, locality);
  if (fromTree?.block) {
    return {
      block: fromTree.block,
      panchayat: fromTree.panchayat || locality,
      village: fromTree.village ?? "",
    };
  }

  return empty;
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
  return resolveWbLocation(districtName, localityName, hints).block;
}

import wbLocationData from "@/data/wb-locations.json";

export type WbPanchayatNode = {
  panchayat: string;
  villages: string[];
};

export type WBDistrict = {
  district: string;
  blocks: {
    block: string;
    /** Flat names for lookup (panchayat + village). */
    areas: string[];
    panchayats?: WbPanchayatNode[];
  }[];
};

export type WbLocalityIndexEntry = {
  district: string;
  block: string;
  panchayat: string;
  village?: string;
};

export type WbPincodeOfficeEntry = {
  district: string;
  block: string;
  panchayat: string;
  village?: string;
};

/** Official igod.gov.in district names (23). */
export const OFFICIAL_WB_DISTRICTS: string[] =
  wbLocationData.officialDistricts ?? wbLocationData.districts.map((d) => d.district);

/** Full West Bengal district → block → locality tree (generated). */
export const WB_DISTRICTS: WBDistrict[] = wbLocationData.districts;

export const WB_LOCALITY_INDEX: Record<string, WbLocalityIndexEntry> =
  wbLocationData.localityByKey;

export const WB_PINCODE_INDEX: Record<string, WbPincodeOfficeEntry[]> =
  wbLocationData.pincodeByDigits;

export const WB_LOCATION_STATS = wbLocationData.stats;

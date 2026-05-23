import wbLocationData from "@/data/wb-locations.json";

export type WBDistrict = {
  district: string;
  blocks: {
    block: string;
    areas: string[];
  }[];
};

export type WbLocalityIndexEntry = {
  district: string;
  block: string;
  panchayat: string;
};

export type WbPincodeOfficeEntry = {
  district: string;
  block: string;
  panchayat: string;
};

/** Full West Bengal district → block → locality tree (generated). */
export const WB_DISTRICTS: WBDistrict[] = wbLocationData.districts;

export const WB_LOCALITY_INDEX: Record<string, WbLocalityIndexEntry> =
  wbLocationData.localityByKey;

export const WB_PINCODE_INDEX: Record<string, WbPincodeOfficeEntry[]> =
  wbLocationData.pincodeByDigits;

export const WB_LOCATION_STATS = wbLocationData.stats;

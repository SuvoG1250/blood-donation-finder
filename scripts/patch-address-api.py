#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_location_form(t: str, component_jsx: str, district_marker: str) -> str:
    start = t.find(district_marker)
    if start == -1:
        return t
    label_start = t.rfind("<label", max(0, start - 300), start)
    if label_start == -1:
        return t
    end_markers = ["{dropdownLoadError", "{false && dropdownLoadError", "<label className=\"block\">"]
    end = -1
    for m in end_markers:
        pos = t.find(m, start)
        if pos != -1 and (end == -1 or pos < end):
            end = pos
    if end == -1:
        return t
    return t[:label_start] + component_jsx + t[end:]


def patch_emergency() -> None:
    p = ROOT / "src/app/blood/emergency/page.tsx"
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        'import { WB_DISTRICTS } from "@/lib/wbLocations";',
        'import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";',
    )
    for typ in ["DistrictRow", "BlockRow", "PanchayatRow"]:
        t = re.sub(rf"type {typ} = \{{[^}}]+\}};\s*", "", t)
    t = t.replace(
        """  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatRow[]>([]);

  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");""",
        """  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [addressError, setAddressError] = useState<string | null>(null);""",
    )
    t = re.sub(r"  const \[districtsLoading[^\n]+\n  const \[blocksLoading[^\n]+\n  const \[panchayatsLoading[^\n]+\n\n  const \[dropdownLoadError[^\n]+\n\n", "", t)
    t = re.sub(r"  const selectedDistrict = useMemo\([\s\S]*?\);\n  const selectedBlock = useMemo\([\s\S]*?\);\n  const selectedPanchayat = useMemo\([\s\S]*?\);\n\n", "", t)
    t = re.sub(r"  async function loadBlocksForDistrict[\s\S]*?  async function loadPanchayatsForBlock[\s\S]*?  \}\n\n", "", t)
    t = re.sub(r"    const staticDistricts: DistrictRow\[\] = WB_DISTRICTS\.map\([\s\S]*?setDistrictsLoading\(false\);\n    \}\);\n\n", "", t)
    t = t.replace('const districtName = selectedDistrict?.district_name ?? "";', "const districtName = address.district.trim();")
    t = t.replace('const blockName = selectedBlock?.block_name ?? "";', "const blockName = address.block.trim();")
    t = t.replace('const panchayatName = selectedPanchayat?.panchayat_name ?? "";', "const panchayatName = address.panchayat.trim();")
    if "address.pincode.length" not in t:
        t = t.replace(
            "    if (!bloodGroup) {",
            """    if (address.pincode.length !== 6) {
      setLoading(false);
      alert("Please enter a valid 6-digit West Bengal PIN code.");
      return;
    }
    if (addressError) {
      setLoading(false);
      alert(addressError);
      return;
    }
    if (!bloodGroup) {""",
        )
    comp = """              <WbAddressFields
                value={address}
                onChange={setAddress}
                onError={setAddressError}
                panchayatMode="required"
              />

            """
    t = replace_location_form(t, comp, '<span className="text-sm font-medium">District</span>')
    t = t.replace("{dropdownLoadError ? (", "{false ? (")
    p.write_text(t, encoding="utf-8")
    print("emergency ok")


def patch_broadcast() -> None:
    p = ROOT / "src/app/blood/admin/broadcast/page.tsx"
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        'import { WB_DISTRICTS } from "@/lib/wbLocations";',
        'import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";',
    )
    t = re.sub(r"type DistrictRow = \{ district_id: string; district_name: string \};\s*", "", t)
    t = re.sub(r"type BlockRow = \{ block_id: string; block_name: string \};\s*", "", t)
    t = re.sub(r"type PanchayatRow = \{ panchayat_id: string; panchayat_name: string \};\s*", "", t)
    t = t.replace(
        """  const [districts] = useState<DistrictRow[]>(
    WB_DISTRICTS.map((d) => ({ district_id: d.district, district_name: d.district })),
  );
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatRow[]>([]);
  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");""",
        """  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [addressError, setAddressError] = useState<string | null>(null);""",
    )
    t = re.sub(r"  const selectedDistrict = useMemo\([\s\S]*?\);\n  const selectedBlock = useMemo\([\s\S]*?\);\n  const selectedPanchayat = useMemo\([\s\S]*?\);\n\n", "", t)
    t = t.replace(
        '  const district = selectedDistrict?.district_name ?? "";\n  const block = selectedBlock?.block_name ?? "";\n  const panchayat = selectedPanchayat?.panchayat_name ?? "";',
        '  const district = address.district.trim();\n  const block = address.block.trim();\n  const panchayat = address.panchayat.trim();',
    )
    t = re.sub(r"  function loadBlocksForDistrict[\s\S]*?  function loadPanchayatsForBlock[\s\S]*?  \}\n\n", "", t)
    comp = """          <motionless className="sm:col-span-2">
            <WbAddressFields
              value={address}
              onChange={setAddress}
              onError={setAddressError}
              panchayatMode="optional"
            />
          </motionless>

"""
    t = replace_location_form(t, comp.replace("motionless", "motionless"), '<span className="font-medium text-zinc-700">District</span>')
    t = comp.replace("motionless", "motionless")  # noop fix
    # fix div
    comp = """          <motionless className="sm:col-span-2">
            <WbAddressFields
              value={address}
              onChange={setAddress}
              onError={setAddressError}
              panchayatMode="optional"
            />
          </motionless>

"""
    # redo broadcast replace properly
    start = t.find('<span className="font-medium text-zinc-700">District</span>')
    if start != -1:
        label_start = t.rfind('<label className="block text-sm">', 0, start)
        end = t.find('<label className="sm:col-span-2 block">', start)
        if label_start != -1 and end != -1:
            comp2 = """          <div className="sm:col-span-2">
            <WbAddressFields
              value={address}
              onChange={setAddress}
              onError={setAddressError}
              panchayatMode="optional"
            />
          </div>

"""
            t = t[:label_start] + comp2 + t[end:]
    p.write_text(t, encoding="utf-8")
    print("broadcast ok")


def patch_search() -> None:
    p = ROOT / "src/app/blood/search/page.tsx"
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        'import { WB_DISTRICTS } from "@/lib/wbLocations";',
        'import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";',
    )
    for typ in ["DistrictRow", "BlockRow", "PanchayatRow"]:
        t = re.sub(rf"type {typ} = \{{[^}}]+\}};\s*", "", t)
    t = t.replace(
        """  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatRow[]>([]);

  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");""",
        """  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [addressError, setAddressError] = useState<string | null>(null);""",
    )
    t = re.sub(r"  const \[districtsLoading[^\n]+\n  const \[blocksLoading[^\n]+\n  const \[panchayatsLoading[^\n]+\n\n  const \[dropdownLoadError[^\n]+\n\n", "", t)
    t = re.sub(r"  const selectedDistrict = districts\.find\([\s\S]*?\);\n  const selectedBlock = blocks\.find\([\s\S]*?\);\n  const selectedPanchayat = panchayats\.find\([\s\S]*?\);\n\n", "", t)
    t = re.sub(r"  useEffect\(\(\) => \{\n    const staticDistricts: DistrictRow\[\] = WB_DISTRICTS\.map\([\s\S]*?\}, \[\]\);\n\n  async function loadBlocksForDistrict[\s\S]*?  async function loadPanchayatsForBlock[\s\S]*?  \}\n\n", "", t)
    # URL params
    t = t.replace("      setDistrictId(d);", "      setAddress((prev) => ({ ...prev, district: d }));")
    t = t.replace("      setBlocks(staticBlocks);", "")
    t = t.replace("      setBlockId(b);", "      setAddress((prev) => ({ ...prev, district: d, block: b }));")
    t = t.replace("      setPanchayats(staticPanchayats);", "")
    t = t.replace("      if (p) setPanchayatId(p);", "      if (p) setAddress((prev) => ({ ...prev, district: d, block: b, panchayat: p }));")
    t = re.sub(r"      const district = WB_DISTRICTS\.find[\s\S]*?if \(p\) setAddress[\s\S]*?\n    \}\);", """      if (v) setAddress((prev) => ({ ...prev, village: v }));
    });""", t)
    # fix url init block - remove WB block entirely
    t = re.sub(
        r"      if \(!d\) return;\n\n      setAddress\(\(prev\) => \(\{ \.\.\.prev, district: d \}\)\);\n[\s\S]*?if \(p\) setAddress\(\(prev\) => \(\{ \.\.\.prev, district: d, block: b, panchayat: p \}\)\);",
        """      if (d) setAddress((prev) => ({ ...prev, district: d }));
      if (b) setAddress((prev) => ({ ...prev, district: d || prev.district, block: b }));
      if (p) setAddress((prev) => ({ ...prev, district: d || prev.district, block: b || prev.block, panchayat: p }));""",
        t,
        count=1,
    )
    t = t.replace("    if (districtId) params.set(\"d\", districtId);", '    if (address.district) params.set("d", address.district);')
    t = t.replace("    if (blockId) params.set(\"b\", blockId);", '    if (address.block) params.set("b", address.block);')
    t = t.replace("    if (panchayatId) params.set(\"p\", panchayatId);", '    if (address.panchayat) params.set("p", address.panchayat);')
    t = t.replace("    if (village.trim()) params.set(\"v\", village.trim());", '    if (address.village.trim()) params.set("v", address.village.trim());')
    t = t.replace("    if (!selectedDistrict?.district_name)", "    if (!address.district.trim())")
    t = t.replace("    if (!selectedBlock?.block_name)", "    if (!address.block.trim())")
    t = t.replace("p_district: selectedDistrict?.district_name ?? \"\"", "p_district: address.district.trim()")
    t = t.replace("p_block: selectedBlock?.block_name ?? \"\"", "p_block: address.block.trim()")
    t = t.replace("if (selectedPanchayat?.panchayat_name)", "if (address.panchayat.trim())")
    t = t.replace("p_panchayat: selectedPanchayat.panchayat_name", "p_panchayat: address.panchayat.trim()")
    t = t.replace("const isAllPanchayats = !selectedPanchayat?.panchayat_name", "const isAllPanchayats = !address.panchayat.trim()")
    t = t.replace("!selectedPanchayat?.panchayat_name ||", "!address.panchayat.trim() ||")
    t = t.replace("areaMatches(r.panchayat, selectedPanchayat.panchayat_name)", "areaMatches(r.panchayat, address.panchayat.trim())")
    t = t.replace("districtId,", "district: address.district,").replace("blockId,", "block: address.block,").replace("panchayatId,", "panchayat: address.panchayat,")
    t = t.replace("village,", "village: address.village,")
    t = t.replace("setDistrictId(p.districtId)", "setAddress((prev) => ({ ...prev, district: p.district, block: p.block, panchayat: p.panchayat, village: p.village }))")
    t = re.sub(r"    const district = WB_DISTRICTS\.find[\s\S]*?setPanchayats\(staticPanchayats\);\n", "", t)
    t = t.replace("districtId: string", "district: string").replace("blockId: string", "block: string").replace("panchayatId: string", "panchayat: string")
    comp = """            <WbAddressFields
              value={address}
              onChange={setAddress}
              onError={setAddressError}
              panchayatMode="optional"
              showVillage
            />

            """
    t = replace_location_form(t, comp, '<span className="text-sm font-medium">District</span>')
    t = t.replace("{!dropdownLoadError && !districtsLoading && districts.length === 0", "{false && !dropdownLoadError")
    p.write_text(t, encoding="utf-8")
    print("search ok")


if __name__ == "__main__":
    patch_emergency()
    patch_broadcast()
    patch_search()

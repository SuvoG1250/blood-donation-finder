from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fix_search() -> None:
    p = ROOT / "src/app/blood/search/page.tsx"
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        """  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [panchayatsLoading, setPanchayatsLoading] = useState(false);

  const [dropdownLoadError, setDropdownLoadError] = useState<string | null>(
    null,
  );

  const [village: address.village, setVillage] = useState("");
""",
        "",
    )
    t = t.replace("village: address.village,", "village,")
    t = t.replace("      if (v) setVillage(v);\n", "")
    t = t.replace('selectedDistrict?.district_name ?? ""', "address.district.trim()")
    t = t.replace('selectedBlock?.block_name ?? ""', "address.block.trim()")
    t = t.replace("const qVillage = village.trim()", "const qVillage = address.village.trim()")
    old = """      if (!d) return;

      setAddress((prev) => ({ ...prev, district: d }));
      if (v) setAddress((prev) => ({ ...prev, village: v }));"""
    new = """      if (d) setAddress((prev) => ({ ...prev, district: d }));
      if (b) setAddress((prev) => ({ ...prev, district: d || prev.district, block: b }));
      if (p) setAddress((prev) => ({
        ...prev,
        district: d || prev.district,
        block: b || prev.block,
        panchayat: p,
      }));
      if (v) setAddress((prev) => ({ ...prev, village: v }));"""
    t = t.replace(old, new)
    start = t.find('<span className="text-sm font-medium">Block</span>')
    end = t.find('<span className="text-sm font-medium">Preferred Day (optional)</span>')
    if start != -1 and end != -1:
        t = t[:start] + t[end:]
    t = t.replace("{false && !dropdownLoadError ? (", "{false ? (")
    p.write_text(t, encoding="utf-8")
    print("search ok")


def fix_emergency() -> None:
    p = ROOT / "src/app/blood/emergency/page.tsx"
    t = p.read_text(encoding="utf-8")
    start = t.find('<span className="text-sm font-medium">Block</span>')
    marker = "            </motionless>\n\n            {false ? ("
    if "            </motionless>" not in t:
        marker = "            </motionless>\n\n            {false ? ("
    end = t.find("            </div>\n\n            {false ? (")
    if start != -1 and end != -1 and end > start:
        t = t[:start] + t[end:]
    p.write_text(t, encoding="utf-8")
    print("emergency ok")


if __name__ == "__main__":
    fix_search()
    fix_emergency()

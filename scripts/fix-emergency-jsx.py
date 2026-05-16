from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/app/blood/emergency/page.tsx"
lines = p.read_text(encoding="utf-8").splitlines()
out: list[str] = []
i = 0
while i < len(lines):
    line = lines[i]
    if line.strip().startswith("<WbAddressFields") or (
        "WbAddressFields" in line and "<" in line
    ):
        out.append("              <WbAddressFields")
        i += 1
        while i < len(lines) and "/>" not in lines[i]:
            out.append("                " + lines[i].strip())
            i += 1
        if i < len(lines):
            out.append("              />")
            i += 1
        out.append("            </div>")
        while i < len(lines):
            s = lines[i].strip()
            if s == "</motionless>" or s == "</div>":
                i += 1
                continue
            if s.startswith("{false"):
                i += 1
                while i < len(lines) and ") : null}" not in lines[i]:
                    i += 1
                if i < len(lines):
                    i += 1
                continue
            if "dropdownLoadError" in lines[i]:
                i += 1
                continue
            if s == '<label className="block">' and i + 1 < len(lines) and lines[i + 1].strip() in (
                "</div>",
                "</motionless>",
            ):
                i += 2
                continue
            break
        continue
    out.append(line)
    i += 1

p.write_text("\n".join(out) + "\n", encoding="utf-8")
print("fixed emergency jsx")

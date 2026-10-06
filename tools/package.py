"""Build distributable .mcaddon files (zip of BP + RP).

    npm run package
      dist/Behemoth-<version>.mcaddon                 framework (publish this)
      dist/<BossPack>-<version>.mcaddon               public boss packs (e.g. the demo)
      private/<Boss>/dist/<BossPack>-<version>.mcaddon   converted licensed bosses (never commit)

TypeScript declaration files (*.d.ts) and converter markers are left out.
"""

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_SUFFIXES = (".d.ts",)
SKIP_NAMES = {".bhmconv-output", ".DS_Store", "Thumbs.db", "desktop.ini"}


def version_of(bp: Path) -> str:
    header = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))["header"]
    return ".".join(str(x) for x in header["version"]), header["name"]


def build(bp: Path, rp: Path, out_dir: Path) -> Path:
    ver, name = version_of(bp)
    safe = re.sub(r"[^A-Za-z0-9]+", "", name)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{safe}-{ver}.mcaddon"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, prefix in ((bp, f"{safe}_BP"), (rp, f"{safe}_RP")):
            if not folder.exists():
                continue
            for f in sorted(folder.rglob("*")):
                if f.is_dir() or f.name in SKIP_NAMES or f.name.endswith(SKIP_SUFFIXES):
                    continue
                z.write(f, f"{prefix}/{f.relative_to(folder).as_posix()}")
    return target


def main() -> int:
    built = [build(ROOT / "packs" / "behemoth" / "BP", ROOT / "packs" / "behemoth" / "RP", ROOT / "dist")]
    for d in sorted((ROOT / "packs").iterdir()):
        if d.name != "behemoth" and (d / "BP" / "manifest.json").exists():
            built.append(build(d / "BP", d / "RP", ROOT / "dist"))
    priv = ROOT / "private"
    if priv.exists():
        for d in sorted(priv.iterdir()):
            pack = d / "pack"
            if (pack / "BP" / "manifest.json").exists():
                built.append(build(pack / "BP", pack / "RP", d / "dist"))
    for b in built:
        print(f"[package] {b.relative_to(ROOT)}  ({b.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

// Locates the framework and every boss pack, for deploy / validate / sim / package.
//   framework   packs/behemoth/{BP,RP}
//   boss packs  packs/<name>/{BP,RP}            (public, e.g. the demo pack)
//               private/<Boss>/pack/{BP,RP}     (converted licensed bosses, git-ignored)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const framework = { name: "Behemoth", bp: join(root, "packs", "behemoth", "BP"), rp: join(root, "packs", "behemoth", "RP") };

/** @returns {{ name: string, bp: string, rp: string, private: boolean }[]} */
export function bossPacks() {
  const out = [];
  const add = (bp, rp, isPrivate) => {
    if (!existsSync(join(bp, "manifest.json"))) return;
    const name = JSON.parse(readFileSync(join(bp, "manifest.json"), "utf8")).header.name;
    out.push({ name, bp, rp, private: isPrivate });
  };
  for (const d of readdirSync(join(root, "packs"))) {
    if (d === "behemoth") continue;
    add(join(root, "packs", d, "BP"), join(root, "packs", d, "RP"), false);
  }
  const priv = join(root, "private");
  if (existsSync(priv)) {
    for (const d of readdirSync(priv)) add(join(priv, d, "pack", "BP"), join(priv, d, "pack", "RP"), true);
  }
  return out;
}

/** Folder-safe name for the game's development pack folders. @param {string} name */
export const folderName = (name) => name.replace(/[^A-Za-z0-9]+/g, "");

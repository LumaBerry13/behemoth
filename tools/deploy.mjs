// Copies BP/ and RP/ into the game's development pack folders, then overlays
// private/build/{BP,RP} (converted licensed bosses, never committed) on top.
//   npm run deploy                        → Minecraft Bedrock (GDK) com.mojang
//   MB_COM_MOJANG=<path> npm run deploy   → custom target (e.g. a BDS folder layout)
// Enable both packs on the test world once; afterwards /reload picks up script
// changes (RP / entity JSON changes need a world rejoin).
//
// RP/texts/*.lang files from the overlay are appended to en_US.lang.
import { cpSync, rmSync, existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const overlay = join(root, "private", "build");
const comMojang =
  process.env.MB_COM_MOJANG ?? join(process.env.APPDATA ?? "", "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang");

if (!existsSync(comMojang)) {
  console.error(`[deploy] com.mojang not found: ${comMojang}\nSet MB_COM_MOJANG to your com.mojang folder.`);
  process.exit(1);
}

const packs = [
  { name: "BP", to: join(comMojang, "development_behavior_packs", "MythicBedrock_BP") },
  { name: "RP", to: join(comMojang, "development_resource_packs", "MythicBedrock_RP") },
];

const noTypes = (src) => !src.endsWith(".d.ts");

for (const { name, to } of packs) {
  rmSync(to, { recursive: true, force: true });
  cpSync(join(root, name), to, { recursive: true, filter: noTypes });
  console.log(`[deploy] ${name} → ${to}`);

  const extra = join(overlay, name);
  if (!existsSync(extra)) continue;
  const isLang = (src) => src.endsWith(".lang");
  cpSync(extra, to, { recursive: true, filter: (src) => noTypes(src) && !isLang(src) });
  const texts = join(extra, "texts");
  if (existsSync(texts)) {
    for (const f of readdirSync(texts).filter((f) => f.endsWith(".lang"))) {
      appendFileSync(join(to, "texts", "en_US.lang"), "\n" + readFileSync(join(texts, f), "utf8"));
    }
  }
  console.log(`[deploy]   + overlay ${extra}`);
}

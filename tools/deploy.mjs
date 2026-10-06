// Copies the Behemoth framework and every boss pack into the game's
// development pack folders:
//   packs/behemoth            → Behemoth_BP / Behemoth_RP
//   packs/<boss pack>         → <PackName>_BP / _RP   (e.g. the demo pack)
//   private/<Boss>/pack       → <PackName>_BP / _RP   (converted licensed bosses)
//   npm run deploy                         → Minecraft Bedrock (GDK) com.mojang
//   BHM_COM_MOJANG=<path> npm run deploy   → custom target (e.g. a BDS folder layout)
// Enable the framework and the boss packs on the test world once; afterwards
// /reload picks up script changes (RP / entity JSON changes need a world rejoin).
import { cpSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { framework, bossPacks, folderName } from "./packs.mjs";

const comMojang =
  process.env.BHM_COM_MOJANG ?? join(process.env.APPDATA ?? "", "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang");

if (!existsSync(comMojang)) {
  console.error(`[deploy] com.mojang not found: ${comMojang}\nSet BHM_COM_MOJANG to your com.mojang folder.`);
  process.exit(1);
}

const devBP = join(comMojang, "development_behavior_packs");
const devRP = join(comMojang, "development_resource_packs");
const noTypes = (src) => !src.endsWith(".d.ts");

// Pre-rename framework folders: remove so the old pack can't load next to Behemoth.
for (const legacy of [join(devBP, "MythicBedrock_BP"), join(devRP, "MythicBedrock_RP")]) {
  if (existsSync(legacy)) {
    rmSync(legacy, { recursive: true, force: true });
    console.log(`[deploy] removed legacy ${legacy}`);
  }
}

for (const pack of [framework, ...bossPacks()]) {
  const name = folderName(pack.name);
  for (const [src, to] of [[pack.bp, join(devBP, `${name}_BP`)], [pack.rp, join(devRP, `${name}_RP`)]]) {
    if (!existsSync(src)) continue;
    rmSync(to, { recursive: true, force: true });
    cpSync(src, to, { recursive: true, filter: noTypes });
    console.log(`[deploy] ${pack.name}: ${src} → ${to}`);
  }
}

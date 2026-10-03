// Copies BP/ and RP/ into the game's development pack folders.
//   npm run deploy                 → Minecraft Bedrock (GDK) com.mojang
//   MB_COM_MOJANG=<path> npm run deploy   → custom target (e.g. a BDS folder layout)
// Then enable both packs on the test world once; afterwards /reload picks up
// script changes (RP / entity JSON changes need a world rejoin).
import { cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const comMojang =
  process.env.MB_COM_MOJANG ?? join(process.env.APPDATA ?? "", "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang");

if (!existsSync(comMojang)) {
  console.error(`[deploy] com.mojang not found: ${comMojang}\nSet MB_COM_MOJANG to your com.mojang folder.`);
  process.exit(1);
}

const targets = [
  { from: join(root, "BP"), to: join(comMojang, "development_behavior_packs", "MythicBedrock_BP") },
  { from: join(root, "RP"), to: join(comMojang, "development_resource_packs", "MythicBedrock_RP") },
];

for (const { from, to } of targets) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".d.ts") });
  console.log(`[deploy] ${from} → ${to}`);
}

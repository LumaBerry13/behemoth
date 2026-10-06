// Offline config check: runs the framework's real Validator over every boss
// pack's configs in Node, without the game. Exit code 1 on any error or warning.
//   npm run validate                    all boss packs (packs/*, private/*/pack)
//   node tools/validate.mjs --config f  just one boss config module (converter tests)
// Works because modules, registry, validator and configs never import
// @minecraft/server directly (only the adapter does).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { framework, bossPacks } from "./packs.mjs";

const fw = (p) => import(pathToFileURL(join(framework.bp, "scripts", p)).href);
const { SkillManager, bindModules } = await fw("registry/SkillManager.js");
const { Validator } = await fw("core/Validator.js");
const { decodeConfigTracks } = await fw("core/TrackCodec.js");

let problems = 0;
const origWarn = console.warn;
const origError = console.error;
console.warn = (...a) => { problems++; origWarn(...a); };
console.error = (...a) => { problems++; origError(...a); };

const registry = new SkillManager();
bindModules(registry);
registry.checkRequires();
console.log(`[validate] ${registry.summary()}`);

/** @type {{ source: string, config: any }[]} */
const configs = [];
const cfgArg = process.argv.indexOf("--config");
if (cfgArg >= 0) {
  const mod = await import(pathToFileURL(process.argv[cfgArg + 1]).href);
  configs.push({ source: process.argv[cfgArg + 1], config: mod.default });
} else {
  for (const pack of bossPacks()) {
    const mod = await import(pathToFileURL(join(pack.bp, "scripts", "bosses", "index.js")).href);
    for (const config of mod.default) configs.push({ source: pack.name, config });
  }
}

const validator = new Validator(registry);
const seen = new Map();
for (const { source, config } of configs) {
  if (seen.has(config.id)) console.error(`[validate] ${config.id} is provided by both "${seen.get(config.id)}" and "${source}"`);
  seen.set(config.id, source);
  // Exactly what the framework receives: JSON round-trip (connector) + track decoding.
  const wire = JSON.parse(JSON.stringify(config));
  decodeConfigTracks(wire);
  const compiled = validator.compile(wire);
  if (!compiled) continue;
  for (const [name, skill] of compiled.skills) {
    const trig = skill.triggers.map((t) => t.name + (t.arg ? `:${t.arg}` : "")).join(",") || "(called)";
    console.log(`  [${source}] ${config.id} · ${name} [${trig}] steps=${skill.steps.length} cd=${skill.cooldown}`);
  }
}

console.log(problems ? `[validate] ${problems} problem(s)` : "[validate] OK");
process.exit(problems ? 1 : 0);

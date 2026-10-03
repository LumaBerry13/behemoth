// Offline config check: runs the framework's real Validator over every bound
// boss config in Node, without the game. Exit code 1 on any error or warning.
//   npm run validate
// Works because modules, registry, validator and configs never import
// @minecraft/server directly (only the adapter does).
import { SkillManager, bindModules } from "../BP/scripts/registry/SkillManager.js";
import { Validator } from "../BP/scripts/core/Validator.js";
import { bindBosses } from "../BP/scripts/bosses/index.js";

let problems = 0;
const origWarn = console.warn;
const origError = console.error;
console.warn = (...a) => { problems++; origWarn(...a); };
console.error = (...a) => { problems++; origError(...a); };

const registry = new SkillManager();
bindModules(registry);
registry.checkRequires();
console.log(`[validate] ${registry.summary()}`);

const configs = [];
bindBosses({ bind: (c) => configs.push(c) });

const validator = new Validator(registry);
for (const cfg of configs) {
  const compiled = validator.compile(cfg);
  if (!compiled) continue;
  for (const [name, skill] of compiled.skills) {
    const trig = skill.triggers.map((t) => t.name + (t.arg ? `:${t.arg}` : "")).join(",") || "(called)";
    console.log(`  ${cfg.id} · ${name} [${trig}] steps=${skill.steps.length} cd=${skill.cooldown}`);
  }
}

console.log(problems ? `[validate] ${problems} problem(s)` : "[validate] OK");
process.exit(problems ? 1 : 0);

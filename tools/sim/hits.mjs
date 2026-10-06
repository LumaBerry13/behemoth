// Hit test: swings each attack skill at players placed around the boss and
// reports which positions get hit, using the real framework, the real baked
// animation tracks and the real hitbox code (Script API stubbed). The boss faces
// the player (as it does in game) and the attack is forced.
//   npm run sim:hits -- <bossTypeId> <skill,skill,...> [--death-event E]
import { boot } from "./boot.mjs";

const args = process.argv.slice(2);
const typeId = args[0] ?? "boss:dark_knight";
const skills = (args[1] ?? "").split(",").filter(Boolean);

const { mc, services } = await boot();
// BHM_SEED=<n> makes runs repeatable (random skill picks, summon spots) for before/after comparisons.
if (process.env.BHM_SEED) services.random.setSeed(Number(process.env.BHM_SEED));

const dim = mc.world.getDimension("overworld");
const entity = new mc.Entity(typeId, dim, { x: 0, y: 64, z: 0 }, { health: 1000, height: 3, speed: 0.3 });
mc.world.afterEvents.entitySpawn.fire({ entity, cause: "Spawned" });
mc.tick(1);
const boss = services.bosses.get(entity.id);
if (!boss) throw new Error(`no boss instance for ${typeId}`);
const list = skills.length ? skills : [...boss.compiled.skills.keys()];

const DISTANCES = [1.5, 2.5, 3.5, 4.5];
const ANGLES = [-90, -45, 0, 45, 90, 180]; // relative to the boss's facing; + = boss's left
const angleName = (a) => ({ "-90": "right", "-45": "fr-right", 0: "front", 45: "fr-left", 90: "left", 180: "behind" })[a];

for (const skill of list) {
  const rows = [];
  let pigs = [];
  for (const d of DISTANCES) {
    const row = [];
    for (const ang of ANGLES) {
      // Fresh player each trial (hit cooldowns are per entity).
      const r = (ang * Math.PI) / 180;
      // Boss faces +Z (yaw 0); its left is +X.
      const p = new mc.Player("T", dim, { x: Math.sin(r) * d, y: 64, z: Math.cos(r) * d });
      boss.cancelAll();
      boss.facingLocked = false;
      boss.hitCooldowns.clear();
      entity.rotation.y = 0;
      const logStart = mc.log.length;
      // Face the player like in game, then lock facing so the swing keeps yaw 0.
      boss.facingLocked = true;
      services.executor.castByName(boss, skill, { triggerEntity: p }, { force: true, inherited: [p] });
      mc.tick(120);
      const t0 = mc.log[logStart]?.[0] ?? 0;
      // Only this swing: natural timer attacks start ~40+ ticks later.
      const hurt = mc.log.slice(logStart).find(([t, k, dt]) => k === "hurt" && dt.startsWith("minecraft:player") && t - t0 <= 60);
      row.push(hurt ? `HIT@${hurt[0] - t0}` : "-");
      pigs.push(...mc.log.slice(logStart).filter(([, k, dt]) => k === "spawn" && dt.startsWith("minecraft:pig")).map(([, , dt]) => dt));
      p.remove();
      for (const e of [...dim.entities]) if (e.typeId === "minecraft:pig") e.remove();
    }
    rows.push(`  d=${d.toFixed(1)}  ` + row.map((c) => c.padEnd(8)).join(""));
  }
  console.log(`\n${skill}`);
  console.log("  dist  " + ANGLES.map((a) => angleName(a).padEnd(8)).join(""));
  for (const r of rows) console.log(r);
  if (pigs.length) console.log(`  summons: ${[...new Set(pigs)].slice(0, 3).join(" | ")}`);
}

// Vanilla melee from the boss must be cancelled (ai.vanillaMelee=false); framework damage must not.
const victim = new mc.Player("V", dim, { x: 0, y: 64, z: 2 });
const hp0 = victim.health.currentValue;
victim.applyDamage(5, { cause: "entityAttack", damagingEntity: entity }); // what vanilla melee_attack does
const meleeCancelled = victim.health.currentValue === hp0;
services.adapter.applyDamage(victim, 5, entity, "entityAttack"); // what the damage mechanic does
const skillLanded = victim.health.currentValue === hp0 - 5;
console.log(`\nvanilla melee cancelled: ${meleeCancelled}  ·  skill damage lands: ${skillLanded}`);
boss.setSpeed(1);
console.log(`walk speed after setSpeed(1): ${entity.movement.currentValue} (config ${boss.config.stats?.movementSpeed})`);

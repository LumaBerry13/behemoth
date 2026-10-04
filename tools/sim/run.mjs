// Headless simulation: loads the real framework (main.js) against the
// @minecraft/server stub, spawns a boss next to a player, runs N ticks and
// prints what happened. Catches runtime errors and broken skill flows before
// an in-game test. No physics or pathing: positions only change via `--walk`.
//   npm run sim -- [bossTypeId] [ticks] [--hit N] [--distance D] [--walk]
// --hit N      the player hits the boss for N damage every 20 ticks
// --distance D initial player distance in blocks (default 3)
// --walk       mark the boss as moving (for `moving` conditions)
// --debug      framework debug logging (skill casts)
// --death-event E  emulate an entity-JSON custom death: fatal damage fires event E instead of dying
import { register } from "node:module";

register("./loader.mjs", import.meta.url);

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const debug = args.includes("--debug") ? (args.splice(args.indexOf("--debug"), 1), true) : false;
const walk = args.includes("--walk") ? (args.splice(args.indexOf("--walk"), 1), true) : false;
const hit = Number(flag("--hit", 0));
const deathEvent = flag("--death-event", undefined);
const distance = Number(flag("--distance", 3));
const typeId = args[0] ?? "mb:test_boss";
const ticks = Number(args[1] ?? 400);

const mc = await import("./mc_stub.mjs");
await import("../../BP/scripts/main.js");
if (debug) (await import("../../BP/scripts/core/Logger.js")).Log.setLevel("debug");

const dim = mc.world.getDimension("overworld");
const player = new mc.Player("Tester", dim, { x: 0, y: 64, z: distance });
mc.tick(2); // scheduler start + scan

const boss = new mc.Entity(typeId, dim, { x: 0, y: 64, z: 0 }, { health: 200, height: 3, speed: 0.3 });
if (deathEvent) {
  // Custom-death bosses (fatal damage_sensor): the entity JSON fires its death event instead of dying.
  boss.onFatal = (e) => {
    e.health.currentValue = 1;
    mc.world.afterEvents.dataDrivenEntityTrigger.fire({ entity: e, eventId: deathEvent });
  };
}
mc.world.afterEvents.entitySpawn.fire({ entity: boss, cause: "Spawned" });

for (let t = 0; t < ticks; t++) {
  if (walk) boss.velocity = { x: 0.1, y: 0, z: 0 };
  if (hit && t % 20 === 10 && boss.isValid) boss.applyDamage(hit, { cause: "entityAttack", damagingEntity: player });
  mc.tick(1);
}

const kinds = new Set(["chat", "anim", "event", "sound", "spawn", "hurt", "hurt-cancel", "knockback", "impulse", "effect", "cooldown", "drop", "particle"]);
for (const [t, kind, detail] of mc.log) if (kinds.has(kind)) console.log(`t=${String(t).padStart(4)} ${kind.padEnd(10)} ${detail}`);
console.log(`[sim] ${ticks} ticks, ${mc.log.length} events. Boss hp=${boss.health.currentValue} valid=${boss.isValid} speed=${boss.movement.currentValue} props=${JSON.stringify(boss.props)} tags=${[...boss.tags]}`);

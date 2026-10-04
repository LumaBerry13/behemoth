// Scenario regression tests for the framework (headless, @minecraft/server
// stubbed). Each scenario sets up entities, runs ticks and asserts outcomes.
//   npm run sim:scenarios -- [bossTypeId] [--death-event E]
// Uses the given boss (default: the converted Dark Knight if present, else the
// test boss) for every scenario.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const deathEvent = flag("--death-event", "dark_knight:start_death");
const typeArg = args[0];

const mc = await import("./mc_stub.mjs");
await import("../../BP/scripts/main.js");
const { services } = await import("../../BP/scripts/core/services.js");
const dim = mc.world.getDimension("overworld");
mc.tick(2);

const typeId = typeArg ?? (services.bosses.configs.has("boss:dark_knight") ? "boss:dark_knight" : "mb:test_boss");
const usesCustomDeath = !!services.bosses.configs.get(typeId)?.config.death?.event;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

function clearWorld() {
  for (const e of [...dim.entities]) e.remove();
}

function spawnBoss(x, z) {
  const e = new mc.Entity(typeId, dim, { x, y: 64, z }, { health: 200, height: 3, speed: 0.3 });
  if (usesCustomDeath) {
    e.onFatal = (ent) => {
      ent.health.currentValue = 1;
      mc.world.afterEvents.dataDrivenEntityTrigger.fire({ entity: ent, eventId: deathEvent });
    };
  }
  mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
  mc.tick(1);
  return { e, boss: services.bosses.get(e.id) };
}

/** First attack skill whose name looks like an attack, for forced swings. */
function attackSkill(boss) {
  const names = [...boss.compiled.skills.keys()];
  return names.find((n) => /sweep|slam/.test(n)) ?? names[0];
}

console.log(`[scenarios] boss ${typeId}${usesCustomDeath ? " (custom death)" : ""}`);

// ---------------------------------------------------------------------------
console.log("\n1. two bosses: no friendly fire, no boss-vs-boss targeting");
{
  clearWorld();
  const player = new mc.Player("P", dim, { x: 10, y: 64, z: 10 });
  const a = spawnBoss(0, 0);
  const b = spawnBoss(0, 2); // right in front of A
  const hpB = b.e.health.currentValue;
  a.e.rotation.y = 0;
  a.boss.facingLocked = true;
  services.executor.castByName(a.boss, attackSkill(a.boss), { triggerEntity: player }, { force: true, inherited: [player] });
  mc.tick(80);
  check("boss B took no damage from boss A's swing", b.e.health.currentValue === hpB, `hp ${hpB} → ${b.e.health.currentValue}`);
  b.e.applyDamage(5, { cause: "entityAttack", damagingEntity: a.e }); // vanilla hit or stray damage
  check("direct boss→boss damage is cancelled", b.e.health.currentValue === hpB);
  check("boss B still targets the player", b.boss.getTarget()?.id === player.id);
  player.remove();
}

// ---------------------------------------------------------------------------
console.log("\n2. death: body is removed even if the entity JSON never despawns it");
{
  clearWorld();
  const player = new mc.Player("P", dim, { x: 0, y: 64, z: 3 });
  const { e, boss } = spawnBoss(0, 0);
  e.applyDamage(500, { cause: "entityAttack", damagingEntity: player });
  mc.tick(1);
  check("death registered", boss.dead === true);
  if (usesCustomDeath) check("entity still present during death animation", e.isValid);
  const wait = (boss.config.death?.removeAfter ?? 0) + 15;
  mc.tick(Math.max(wait, 20));
  check(usesCustomDeath ? "body removed by the framework backstop" : "vanilla death removed the entity", !e.isValid);
  player.remove();
}

// ---------------------------------------------------------------------------
console.log("\n3. reload during death: dying boss is not re-armed and goes away");
{
  clearWorld();
  const { e, boss } = spawnBoss(0, 0);
  if (usesCustomDeath) {
    e.applyDamage(500, { cause: "entityAttack" });
    mc.tick(1);
    // Simulate a script reload: forget the instance, then fire entityLoad.
    services.bosses.instances.delete(e.id);
    mc.world.afterEvents.entityLoad.fire({ entity: e });
    mc.tick(1);
    check("not re-attached as a live boss", !services.bosses.get(e.id));
    mc.tick(60);
    check("removed shortly after load", !e.isValid);
  } else {
    check("skipped (boss has no custom death)", true);
    boss.destroy();
  }
}

// ---------------------------------------------------------------------------
console.log("\n4. reset when players leave");
{
  clearWorld();
  const player = new mc.Player("P", dim, { x: 0, y: 64, z: 3 });
  const { e, boss } = spawnBoss(0, 0);
  e.applyDamage(30, { cause: "entityAttack", damagingEntity: player });
  e.location = { x: 6, y: 64, z: 6 }; // dragged away from spawn
  mc.tick(5);
  const hurtHp = e.health.currentValue;
  player.location = { x: 500, y: 64, z: 500 }; // leaves
  const wait = boss.config.ai?.resetAfterNoPlayers ?? 0;
  if (!wait) check("skipped (no ai.resetAfterNoPlayers)", true);
  else {
    mc.tick(wait + 40);
    check("health restored", e.health.currentValue === e.health.effectiveMax, `hp ${hurtHp} → ${e.health.currentValue}`);
    check("back at spawn point", Math.hypot(e.location.x, e.location.z) < 0.01);
    check("threat cleared", boss.threat.threat.size === 0);
    const before = mc.log.filter(([, k]) => k === "event").length;
    mc.tick(wait + 40);
    check("an untouched boss does not reset again", mc.log.filter(([, k]) => k === "event").length === before);
  }
  player.remove();
}

// ---------------------------------------------------------------------------
console.log("\n5. leash");
{
  clearWorld();
  const player = new mc.Player("P", dim, { x: 0, y: 64, z: 3 });
  const { e, boss } = spawnBoss(0, 0);
  const leash = boss.config.ai?.leashRange;
  if (!leash) check("skipped (no ai.leashRange)", true);
  else {
    e.location = { x: leash + 5, y: 64, z: 0 };
    player.location = { x: leash + 6, y: 64, z: 0 };
    mc.tick(25);
    check("pulled back to spawn after leaving the leash range", Math.hypot(e.location.x, e.location.z) < 0.01);
  }
  player.remove();
}

// ---------------------------------------------------------------------------
console.log("\n6. invulnerability is script-level (entity groups untouched)");
{
  clearWorld();
  const { e, boss } = spawnBoss(0, 0);
  const events = () => mc.log.filter(([, k, d]) => k === "event" && d.includes("invuln")).length;
  const before = events();
  boss.setInvulnerable(true);
  const hp = e.health.currentValue;
  e.applyDamage(10, { cause: "entityAttack" });
  check("damage cancelled while invulnerable", e.health.currentValue === hp);
  boss.setInvulnerable(false);
  e.applyDamage(10, { cause: "entityAttack" });
  check("damage applies again", e.health.currentValue === hp - 10);
  check("no mb:invuln_* entity events fired", events() === before);
}

// ---------------------------------------------------------------------------
console.log("\n7. module showcase (demo_* skills, test boss only)");
{
  clearWorld();
  const { e, boss } = spawnBoss(0, 0);
  if (!boss.compiled.skills.has("demo_projectile")) check("skipped (boss has no demo_* skills)", true);
  else {
    const player = new mc.Player("P", dim, { x: 0, y: 64, z: 5 });
    e.applyDamage(1, { cause: "entityAttack", damagingEntity: player }); // threat entry
    mc.tick(2);
    /** Cast a demo skill and return the log lines it produced. */
    const run = (name, ticks = 40) => {
      const start = mc.log.length;
      boss.cancelAll();
      services.executor.castByName(boss, name, { triggerEntity: player }, { force: true });
      mc.tick(ticks);
      return mc.log.slice(start);
    };
    const has = (lines, kind, text = "") => lines.some(([, k, d]) => k === kind && d.includes(text));

    let out = run("demo_projectile");
    check("projectile flies and hits (damage + fire)", has(out, "hurt", "minecraft:player") && has(out, "fire", "minecraft:player"));
    check("projectile draws particles along its path", out.filter(([, k]) => k === "particle").length >= 4);
    out = run("demo_pull", 5);
    check("pull pushes the player toward the boss (−z)", has(out, "knockback", "minecraft:player (0, 0.2, -1)"));
    out = run("demo_knockback", 5);
    check("knockback via @Cone hits the player in front", has(out, "knockback", "minecraft:player"));
    const hp0 = e.health.currentValue;
    e.health.currentValue = 100;
    run("demo_heal", 5);
    check("heal +25% of max", e.health.currentValue === 150, `100 → ${e.health.currentValue}`);
    e.health.currentValue = hp0;
    player.health.currentValue = 20;
    out = run("demo_percent", 5);
    check("percentDamage 25% via @ThreatTable", has(out, "hurt", "minecraft:player -5"));
    out = run("demo_lightning", 5);
    check("lightning on @Ring: 6 strikes", out.filter(([, k]) => k === "lightning").length === 6);
    out = run("demo_lunge", 5);
    check("lunge toward @RandomPlayer", has(out, "impulse", "(0, 0.1, 1.4)"));
    out = run("demo_teleport", 5);
    check("teleportBehind moves the boss", has(out, "teleport", "mb:test_boss"));
    e.location = { x: 0, y: 64, z: 0 };
    out = run("demo_blocks", 5);
    const placed = out.filter(([, k, d]) => k === "block" && d.endsWith("cobweb")).length;
    check("tempBlocks placed (mobGriefing on)", placed > 0, `${placed} blocks`);
    check("tempBlocks persisted for reload safety", typeof mc.world.dyn["mb:tempblocks"] === "string");
    out = run("demo_title", 100);
    check("tempBlocks restored to air after their time", out.filter(([, k, d]) => k === "block" && d.endsWith("air")).length === placed);
    check("pending tempBlocks cleared from the world property", mc.world.dyn["mb:tempblocks"] === undefined);
    run("demo_property", 2);
    check("setProperty", e.props["mb:visibility"] === 2);
    let third = 0;
    for (let i = 0; i < 3; i++) third += run("demo_counter", 3).filter(([, k, d]) => k === "chat" && d.includes("Third press")).length;
    check("setVariable + variable condition fire on the 3rd press only", third === 1 && boss.vars.presses === 3);
    check("signal reaches the onSignal handler", mc.log.some(([, k, d]) => k === "actionbar" && d.includes("signal received")));
    check("title + actionBar shown", mc.log.some(([, k, d]) => k === "title" && d.includes("Test Boss")));
    const before = mc.log.length;
    mc.world.afterEvents.playerInteractWithEntity.fire({ player, target: e });
    mc.tick(2);
    check("onInteract + lineOfSight/height/playersNearby", mc.log.slice(before).some(([, k, d]) => k === "chat" && d.includes("ignores you")));
    player.remove();
  }
}

console.log(failures ? `\n[scenarios] ${failures} FAILED` : "\n[scenarios] all passed");
process.exit(failures ? 1 : 0);

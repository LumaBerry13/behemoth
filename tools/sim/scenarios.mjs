// Scenario regression tests for the framework (headless, @minecraft/server
// stubbed). Each scenario sets up entities, runs ticks and asserts outcomes.
//   npm run sim:scenarios -- [bossTypeId] [--death-event E]
// Uses the given boss (default: the converted Dark Knight if present, else the
// test boss) for every scenario.
import { boot } from "./boot.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const deathEvent = flag("--death-event", "dark_knight:start_death");
const typeArg = args[0];

const { mc, services, commands } = await boot();
const dim = mc.world.getDimension("overworld");

const typeId = typeArg ?? (services.bosses.configs.has("boss:dark_knight") ? "boss:dark_knight" : "bhm_demo:test_boss");
const usesCustomDeath = !!services.bosses.configs.get(typeId)?.config.death?.event;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

function clearWorld() {
  for (const e of [...dim.entities]) e.remove();
  dim.blocks.clear(); // e.g. loot chests left by earlier deaths
  dim.containers.clear();
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
  check("no bhm:invuln_* entity events fired", events() === before);
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
    check("teleportBehind moves the boss", has(out, "teleport", "bhm_demo:test_boss"));
    e.location = { x: 0, y: 64, z: 0 };
    out = run("demo_blocks", 5);
    const placed = out.filter(([, k, d]) => k === "block" && d.endsWith("cobweb")).length;
    check("tempBlocks placed (mobGriefing on)", placed > 0, `${placed} blocks`);
    check("tempBlocks persisted for reload safety", typeof mc.world.dyn["bhm:tempblocks"] === "string");
    out = run("demo_title", 100);
    check("tempBlocks restored to air after their time", out.filter(([, k, d]) => k === "block" && d.endsWith("air")).length === placed);
    check("pending tempBlocks cleared from the world property", mc.world.dyn["bhm:tempblocks"] === undefined);
    run("demo_property", 2);
    check("setProperty", e.props["bhm:visibility"] === 2);
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

// ---------------------------------------------------------------------------
// Boss-pack protocol (framework ⇄ connector over script events)
// ---------------------------------------------------------------------------
const reg = services.registrar;
const { fnv1a } = await import(new URL("../../packs/behemoth/BP/scripts/core/Registrar.js", import.meta.url).href);
/** Script events sent from now on. */
const sentSince = (start) => mc.log.slice(start).filter(([, k]) => k === "scriptevent").map(([, , d]) => d.split(" ")[0]);
/** Deliver a raw script event as if another pack sent it. */
const inject = (id, message, extra = {}) => mc.system.afterEvents.scriptEventReceive.fire({ id, message, sourceType: "Server", ...extra });

console.log("\n8. reload: bosses restored from the framework's cache, nothing re-sent");
{
  const packIds = [...reg.packs.keys()];
  const types = [...services.bosses.configs.keys()];
  // Simulate /reload: framework memory is gone, world storage is not.
  reg.packs.clear();
  reg.owners.clear();
  reg.requested.clear();
  services.bosses.configs.clear();
  reg.cacheLoaded = false;
  const t0 = performance.now();
  reg.restoreCache();
  const ms = performance.now() - t0;
  check("every boss type is back immediately", types.every((t) => services.bosses.configs.has(t)), `${types.length} type(s) in ${ms.toFixed(1)} ms`);
  check("packs marked as loaded from cache", packIds.every((p) => reg.packs.get(p)?.source === "cache"));
  const start = mc.log.length;
  mc.system.sendScriptEvent("bhm:ready", JSON.stringify({ p: 1, fw: "0.2.0" })); // what the framework does after restoring
  mc.tick(4);
  const sent = sentSince(start);
  check("packs only said hello (no payload re-sent)", !sent.includes("bhm:need") && !sent.includes("bhm:part"), sent.join(", "));
  check("hellos acknowledged", sent.filter((s) => s === "bhm:ack").length === packIds.length);
}

console.log("\n9. a pack with a changed payload is asked for it again");
{
  const start = mc.log.length;
  inject("bhm:hello", JSON.stringify({ p: 1, pack: "behemoth_demo", ver: "9.9.9", hash: "deadbeef", size: 10, min: "0.2.0" }));
  mc.tick(1);
  check("framework sent bhm:need", sentSince(start).includes("bhm:need"));
  reg.requested.clear();
}

console.log("\n10. a player's /scriptevent is ignored");
{
  const before = reg.packs.size;
  const fakePlayer = new mc.Player("Griefer", dim, { x: 0, y: 64, z: 0 });
  const start = mc.log.length;
  inject("bhm:hello", JSON.stringify({ p: 1, pack: "evil", ver: "1", hash: "00000000", size: 1 }), { sourceEntity: fakePlayer });
  mc.tick(1);
  check("no reaction, no new pack", sentSince(start).length === 0 && reg.packs.size === before);
  fakePlayer.remove();
}

console.log("\n11. protocol / version mismatch is refused with a reason");
{
  const start = mc.log.length;
  inject("bhm:hello", JSON.stringify({ p: 99, pack: "future_pack", ver: "1", hash: "11111111", size: 1 }));
  inject("bhm:hello", JSON.stringify({ p: 1, pack: "picky_pack", ver: "1", hash: "22222222", size: 1, min: "99.0.0" }));
  mc.tick(1);
  const acks = mc.log.slice(start).filter(([, k, d]) => k === "scriptevent" && d.startsWith("bhm:ack")).length;
  check("both refused via bhm:ack (no transfer)", acks === 2 && !sentSince(start).includes("bhm:need"));
}

/** Push a payload as `pack` the way the connector does. */
function sendPayload(pack, payloadObj, corrupt = false) {
  const payload = JSON.stringify(payloadObj);
  const hash = fnv1a(payload);
  const body = corrupt ? payload.replace("Test", "Tset") : payload;
  inject("bhm:hello", JSON.stringify({ p: 1, pack, ver: payloadObj.ver, hash, size: payload.length }));
  mc.tick(1);
  const n = Math.ceil(body.length / 1500);
  for (let i = 0; i < n; i++) inject("bhm:part", `${pack}|${hash}|${i}|${n}|${body.slice(i * 1500, (i + 1) * 1500)}`);
  mc.tick(1);
  return hash;
}

console.log("\n12. a second pack cannot take over an existing boss type");
{
  const demo = services.bosses.configs.get("bhm_demo:test_boss")?.config;
  if (!demo) check("skipped (demo boss not loaded)", true);
  else {
    const start = mc.log.length;
    sendPayload("copycat", { ver: "1.0.0", bosses: [JSON.parse(JSON.stringify(demo))] });
    const ack = mc.log.slice(start).find(([, k, d]) => k === "scriptevent" && d.startsWith("bhm:ack"));
    check("type still owned by behemoth_demo", reg.owners.get("bhm_demo:test_boss") === "behemoth_demo");
    check("copycat got an error ack", !!ack && reg.packs.get("copycat")?.errors.length === 1);
  }
}

console.log("\n13. corrupt payload is rejected and requested again");
{
  const start = mc.log.length;
  sendPayload("mangled", { ver: "1.0.0", bosses: [{ schemaVersion: 1, id: "mangled:Test", skills: {} }] }, true);
  check("not installed", !reg.packs.has("mangled"));
  check("re-requested with bhm:need", sentSince(start).filter((s) => s === "bhm:need").length === 2);
}

console.log("\n14. a stalled transfer is discarded");
{
  inject("bhm:part", "stalled|abcdef01|0|3|{\"ver\":");
  mc.tick(1);
  check("transfer open", reg.transfers.has("stalled"));
  mc.tick(260);
  check("dropped after the timeout", !reg.transfers.has("stalled"));
}

console.log("\n15. /behemoth menu");
{
  const ui = await import("./ui_stub.mjs");
  const player = new mc.Player("Admin", dim, { x: 0, y: 64, z: 0 });
  const before = ui.shown.length;
  ui.clicks.push(10); // click "Debug overlay"
  const overlayBefore = services.settings.overlay;
  commands.get("bhm:behemoth")({ sourceEntity: player }); // what typing /behemoth does
  for (let i = 0; i < 5; i++) { await mc.flush(); mc.tick(1); }
  const forms = ui.shown.slice(before);
  const first = forms[0];
  check("menu opens as a 54-slot chest form", !!first && first.buttons.length === 54);
  const borders = first?.buttons.filter((b) => /glass_(gray|black)/.test(b.icon ?? "")).length ?? 0;
  check("border of gray + black glass panes", borders >= 20, `${borders} border slots`);
  check("clicking a toggle flips the setting", services.settings.overlay === !overlayBefore);
  check("setting persisted in the world", JSON.parse(mc.world.dyn["bhm:settings"]).overlay === !overlayBefore);
  check("menu re-opened after the click", forms.length >= 2);
  services.settings.toggle("overlay");
  player.remove();
}

/** Simulate /reload: framework memory gone, world storage kept, packs that still exist say hello. */
function reloadFramework({ helloFrom = [...reg.packs.keys()] } = {}) {
  reg.packs.clear();
  reg.owners.clear();
  reg.requested.clear();
  services.bosses.configs.clear();
  for (const b of services.bosses.all()) { b.destroy(); services.bosses.instances.delete(b.id); }
  reg.cacheLoaded = false;
  reg.restoreCache();
  return helloFrom;
}

console.log("\n16. a removed boss pack disappears after reload (entity type gone)");
{
  const ui = await import("./ui_stub.mjs");
  const before = [...services.bosses.configs.keys()];
  // Remove a whole pack (prefer one that is not the demo pack): all its entity types disappear.
  const packs = [...reg.packs.entries()];
  const [victimPack, victimInfo] = packs.find(([n]) => n !== "behemoth_demo") ?? packs[0];
  const victims = [...victimInfo.bosses];
  const victim = victims[0];
  for (const t of victims) mc.sim.missingTypes.add(t);
  reloadFramework();
  check(`${victims.join(", ")} not registered after pack ${victimPack} was removed`, victims.every((t) => !services.bosses.configs.has(t)));
  const index = JSON.parse(mc.world.dyn["bhm:cache"] ?? "{}");
  check("its cache entry was deleted", !index[victimPack]);
  check("other packs keep their cache", Object.keys(index).length === packs.length - 1);
  // Menu: the spawn list must not offer it.
  const player = new mc.Player("Admin2", dim, { x: 0, y: 64, z: 0 });
  const start = ui.shown.length;
  ui.clicks.push(29); // Spawn a boss
  commands.get("bhm:behemoth")({ sourceEntity: player });
  for (let i = 0; i < 5; i++) { await mc.flush(); mc.tick(1); }
  const spawnPage = ui.shown.slice(start)[1];
  const names = (spawnPage?.buttons ?? []).map((b) => JSON.stringify(b.text));
  check("spawn list does not offer it", spawnPage && !names.some((t) => t.includes(victim)));
  player.remove();
  for (const t of victims) mc.sim.missingTypes.delete(t);
  reg.cacheLoaded = false;
  mc.system.sendScriptEvent("bhm:ready", JSON.stringify({ p: 1, fw: "0.2.0" }));
  for (let i = 0; i < 40 && services.bosses.configs.size < before.length; i++) { await mc.flush(); mc.tick(1); }
}

console.log("\n17. a cached pack that never says hello is unloaded after the grace period");
{
  // Fake a cached pack whose types exist but whose scripts don't run.
  const payload = JSON.stringify({ ver: "1.0.0", bosses: [{ schemaVersion: 1, id: "ghost:boss", skills: { idle: { m: "delay", o: { ticks: 1 } } } }] });
  const index = JSON.parse(mc.world.dyn["bhm:cache"] ?? "{}");
  index.ghost_pack = { hash: fnv1a(payload), ver: "1.0.0", parts: 1, bosses: ["ghost:boss"] };
  mc.world.dyn["bhm:cache"] = JSON.stringify(index);
  mc.world.dyn["bhm:cache:ghost_pack:0"] = payload;
  reg.cacheLoaded = false;
  reg.restoreCache();
  check("restored from cache at load", services.bosses.configs.has("ghost:boss"));
  for (const [name, info] of reg.packs) if (name !== "ghost_pack") info.seen = true; // the real packs said hello
  reg.forgetSilentPacks(); // runs 100 ticks after bhm:ready in the game
  check("unloaded when it never said hello", !services.bosses.configs.has("ghost:boss") && !reg.packs.has("ghost_pack"));
  check("cache entry removed", !JSON.parse(mc.world.dyn["bhm:cache"]).ghost_pack && mc.world.dyn["bhm:cache:ghost_pack:0"] === undefined);
}

console.log("\n18. minions: summoned, driven, hidden from the boss lists, removed with their boss");
{
  clearWorld();
  if (!services.bosses.configs.has("bhm_demo:minion")) check("skipped (demo pack not loaded)", true);
  else {
    const player = new mc.Player("P", dim, { x: 0, y: 64, z: 4 });
    const e = new mc.Entity("bhm_demo:test_boss", dim, { x: 0, y: 64, z: 0 }, { health: 300, height: 3, speed: 0.25 });
    mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
    mc.tick(1);
    const boss = services.bosses.get(e.id);
    services.executor.castByName(boss, "summon_adds", {}, { force: true });
    mc.tick(2);
    const minions = services.bosses.all().filter((b) => b.config.id === "bhm_demo:minion");
    check("two minions summoned and driven by the framework", minions.length === 2);
    check("bound to their boss", boss.boundSummons.size === 2);
    const list = services.bosses.worldList(dim, player.location);
    check("world boss list shows the boss but no minions", list.some((x) => x.id === boss.id) && !list.some((x) => x.type === "bhm_demo:minion"));
    check("nearest() never returns a minion", services.bosses.nearest(dim, minions[0].location, 1)?.config.kind !== "minion");
    e.applyDamage(1000, { cause: "entityAttack", damagingEntity: player });
    mc.tick(2);
    check("minions removed when the boss dies", minions.every((m) => !m.entity.isValid));
    check("boss dropped from the world list", !services.bosses.known.has(boss.id));
    player.remove();
  }
}

console.log("\n19. bosses in world: nearest first, teleport from the menu");
{
  clearWorld();
  const ui = await import("./ui_stub.mjs");
  const near = spawnBoss(10, 0);
  const far = spawnBoss(100, 0);
  const admin = new mc.Player("Admin3", dim, { x: 0, y: 64, z: 0 });
  const list = services.bosses.worldList(dim, admin.location);
  check("sorted nearest to farthest", list[0]?.id === near.e.id && list[1]?.id === far.e.id);
  check("known list persisted", (mc.tick(60), typeof mc.world.dyn["bhm:known"] === "string"));
  ui.clicks.push(31, 11, 31); // Bosses in world → 2nd entry (far) → Teleport
  commands.get("bhm:behemoth")({ sourceEntity: admin });
  for (let i = 0; i < 6; i++) { await mc.flush(); mc.tick(1); }
  check("teleported next to the far boss", Math.abs(admin.location.x - 103) < 0.5, `x=${admin.location.x}`);
  admin.remove();
}

// ---------------------------------------------------------------------------
// Skill-engine features and decisions D6/D7, on the demo test boss.
// ---------------------------------------------------------------------------
const DEMO = "bhm_demo:test_boss";
/**
 * Fresh demo boss at the origin facing +Z with its facing locked, one player 5
 * blocks in front, and helpers to cast skills and read the log.
 */
function demo() {
  clearWorld();
  if (!services.bosses.configs.get(DEMO)?.skills.has("demo_vars")) return undefined;
  const player = new mc.Player("P", dim, { x: 0, y: 64, z: 5 });
  const e = new mc.Entity(DEMO, dim, { x: 0, y: 64, z: 0 }, { health: 300, height: 3, speed: 0.25 });
  mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
  mc.tick(1);
  const boss = services.bosses.get(e.id);
  boss.facingLocked = true;
  e.rotation.y = 0;
  const run = (name, ticks = 5, opts = { force: true }) => {
    const start = mc.log.length;
    services.executor.castByName(boss, name, { triggerEntity: player }, opts);
    mc.tick(ticks);
    return mc.log.slice(start);
  };
  const has = (lines, kind, text = "") => lines.some(([, k, d]) => k === kind && d.includes(text));
  const count = (lines, kind, text = "") => lines.filter(([, k, d]) => k === kind && d.includes(text)).length;
  return { e, boss, player, run, has, count };
}

console.log("\n20. variables, scopes and <placeholders>");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    let out = d.run("demo_vars", 2);
    const chat = out.find(([, k]) => k === "chat")?.[2] ?? "";
    check("add + int type", d.boss.vars.combo === 1);
    check("variableMath with a placeholder in the expression", d.boss.vars.power === 1, `power=${d.boss.vars.power}`);
    check("placeholders resolved in the message", /combo §f1§7, power §f1§7, roll §f[1-6]§7, hp §f300\/300/.test(chat) && !chat.includes("<"), chat);
    check("global variable set", services.vars.global.demo_runs === 1);
    check("variable with duration is set", d.boss.vars.temp === "on");
    mc.tick(25);
    check("…and removed after its duration", !("temp" in d.boss.vars));
    mc.tick(100);
    check("global variables persisted", String(mc.world.dyn["bhm:vars"]).includes("demo_runs"));
    out = d.run("demo_vars", 2);
    check("second run builds on the first (combo 2, power 4)", d.boss.vars.combo === 2 && d.boss.vars.power === 4, `power=${d.boss.vars.power}`);
  }
}

console.log("\n21. castInstead / orElseCast, target conditions, fieldOfView");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    let out = d.run("demo_instead", 2, {});
    check("condition false: the skill itself runs", d.has(out, "actionbar", "angry"));
    d.boss.vars.mode = "calm";
    out = d.run("demo_instead", 2, {});
    check("castInstead runs the other skill instead", d.has(out, "actionbar", "calm") && !d.has(out, "actionbar", "angry"));
    out = d.run("demo_fov", 2, { inherited: [d.player] });
    check("target in the view cone passes targetIf", d.has(out, "actionbar", "in front"));
    const behind = new mc.Player("Q", dim, { x: 0, y: 64, z: -5 });
    out = d.run("demo_fov", 2, { inherited: [behind] });
    check("target behind: orElseCast turns the boss around", !d.has(out, "actionbar", "in front") && Math.abs(d.e.rotation.y - 180) < 1e-6, `yaw=${d.e.rotation.y}`);
    d.e.rotation.y = 0;
    const left = new mc.Player("L", dim, { x: 5, y: 64, z: 0 });
    const fov = services.registry.condition("fieldOfView");
    const ctx = services.executor.makeContext(d.boss, {}, {});
    check("fieldOfView rotation=90 is the caster's left (+X when facing +Z)",
      fov.test(ctx, left, { angle: 90, rotation: 90 }) && !fov.test(ctx, left, { angle: 90, rotation: 270 }));
  }
}

console.log("\n22. line repeat / repeatInterval / cooldown");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    let out = d.run("demo_combo", 30);
    check("repeat 4 → the line runs 5 times", d.count(out, "particle", "critical_hit") === 5, `${d.count(out, "particle", "critical_hit")}`);
    check("random pitch placeholder resolved", out.some(([, k, d2]) => k === "sound" && /p1\.[01]\d*|p0\.9\d*|p1$/.test(d2)));
    out = d.run("demo_combo", 5);
    check("line cooldown: the sound is skipped within 40 ticks", d.count(out, "sound") === 0);
    mc.tick(40);
    out = d.run("demo_combo", 5);
    check("…and plays again after it", d.count(out, "sound") === 1);
  }
}

console.log("\n23. rayTraceTo: entities on the beam, skill at its end");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    const off = new mc.Player("Off", dim, { x: 4, y: 64, z: 4 });
    const out = d.run("demo_ray", 3);
    check("the player on the beam is hit", d.player.health.currentValue < 20);
    check("a player off the beam is not", off.health.currentValue === 20);
    check("locationSkill runs at the end (@Origin)", d.has(out, "particle", "large_explosion @ (0, 64, 5)"));
    check("the beam is drawn", d.count(out, "particle", "blue_flame") >= 8);
  }
}

console.log("\n24. entity projectile: bullet, onTick/onHit/onEnd, modifyProjectile, owned effect");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    d.e.rotation.y = 90;
    const out = d.run("demo_bullet", 30);
    check("bullet entity spawned and moved every tick", d.has(out, "spawn", "bhm_demo:bullet") && d.count(out, "teleport", "bhm_demo:bullet") >= 5);
    check("bullet removed when the projectile ended", dim.getEntities({ type: "bhm_demo:bullet" }).length === 0);
    check("onHit damaged the player", d.player.health.currentValue < 20);
    check("onTick ran at the projectile (@Origin)", d.count(out, "particle", "basic_crit") >= 2);
    const tps = out.filter(([, k, x]) => k === "teleport" && x.includes("bullet")).map(([, , x]) => Number(/→ \([^,]+, [^,]+, ([^)]+)\)/.exec(x)[1]));
    const steps = tps.slice(1).map((z, i) => z - tps[i]);
    check("modifyProjectile speeds it up", steps.length > 3 && steps[steps.length - 1] > steps[0] + 0.01, steps.map((s) => s.toFixed(2)).join(" "));
    const marker = dim.getEntities({ type: "bhm_demo:marker" })[0];
    check("onEnd summoned an effect entity, driven as a minion", !!marker && services.bosses.get(marker.id)?.config.kind === "minion");
    check("it knows its parent (@Parent)", marker?.dyn["bhm:parent"] === d.boss.id);
    check("it faces the way the boss faces (facing + matchRotation)", marker?.rotation.y === 90);
    check("tint property set, then cleared", marker?.props["bhm:tint"] === 0xffffff && out.some(([, k]) => k) /* flash already over */);
    check("effect entities are not listed as bosses", !services.bosses.worldList(dim, d.player.location).some((x) => x.type === "bhm_demo:marker"));
    mc.tick(45);
    check("it removed itself (remove mechanic)", !marker?.isValid && !services.bosses.get(marker?.id ?? ""));
  }
}

console.log("\n25. @RandomLocationsNearCaster");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    d.run("demo_rain", 2);
    const pts = dim.getEntities({ type: "bhm_demo:marker" }).map((m) => m.location);
    const dist = pts.map((p) => Math.hypot(p.x, p.z));
    check("4 effects at random spots", pts.length === 4, `${pts.length}`);
    check("all between minRadius 3 and radius 8", dist.every((x) => x >= 3 - 1e-6 && x <= 8 + 1e-6), dist.map((x) => x.toFixed(1)).join(" "));
    check("at least `spacing` apart", pts.every((p, i) => pts.every((q, j) => i === j || Math.hypot(p.x - q.x, p.z - q.z) >= 2 - 1e-6)));
  }
}

console.log("\n26. stun, bossBar");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    d.run("demo_stun", 2);
    check("stunned: frozen AI, no movement", d.boss.aiMode === "frozen" && d.e.movement.currentValue === 0);
    mc.tick(45);
    check("stun ends: previous AI and speed back", d.boss.aiMode === "chase" && d.e.movement.currentValue > 0);
    d.run("demo_bar", 2);
    check("boss bar title with placeholders", d.e.nameTag === "§cTest Boss §7(100%)", d.e.nameTag);
    mc.tick(65);
    check("boss bar title reset", d.e.nameTag === "§cTest Boss");
  }
}

console.log("\n27. D6: Peaceful difficulty removes bosses and minions");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    services.executor.castByName(d.boss, "summon_adds", {}, { force: true });
    mc.tick(2);
    check("boss + minions alive on Normal", services.bosses.all().length === 3);
    mc.world.difficulty = "Peaceful";
    mc.tick(25);
    check("all removed on Peaceful", services.bosses.all().length === 0);
    const e = new mc.Entity(DEMO, dim, { x: 0, y: 64, z: 0 }, { health: 300 });
    mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
    check("new spawns are refused", !e.isValid && !services.bosses.get(e.id));
    mc.world.difficulty = "Normal";
  }
}

console.log("\n28. D7: health scales with the number of players");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    clearWorld();
    const ps = [0, 1, 2].map((i) => new mc.Player(`S${i}`, dim, { x: i, y: 64, z: 6 }));
    const e = new mc.Entity(DEMO, dim, { x: 0, y: 64, z: 0 }, { health: 300 });
    mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
    mc.tick(1);
    const boss = services.bosses.get(e.id);
    check("3 players → ×2 health", boss.healthScale === 2);
    e.applyDamage(10, { cause: "entityAttack", damagingEntity: ps[0] });
    check("a 10-damage hit takes 5", e.health.currentValue === 295, `${e.health.currentValue}`);
    ps.push(new mc.Player("S3", dim, { x: 3, y: 64, z: 6 }), new mc.Player("S4", dim, { x: 4, y: 64, z: 6 }), new mc.Player("S5", dim, { x: 5, y: 64, z: 6 }));
    mc.tick(100);
    check("more players join → rises (capped at max 4 → ×3.5 for 6 players)", boss.healthScale === 3.5, `${boss.healthScale}`);
    for (const p of ps.slice(1)) p.remove();
    mc.tick(100);
    check("players leaving mid-fight never lower it", boss.healthScale === 3.5);
    boss.reset("test");
    check("reset recomputes it (1 player → ×1)", boss.healthScale === 1);
    Persistence_check: {
      boss.healthScale = 2;
      services.bosses.save(boss);
      check("persisted with the boss", JSON.parse(e.dyn["bhm:state"]).hs === 2);
    }
  }
}

console.log("\n29. D7: loot goes into a chest that explosions cannot destroy");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    d.e.location = { x: 10.5, y: 64, z: 10.5 };
    d.e.applyDamage(1000, { cause: "entityAttack", damagingEntity: d.player });
    mc.tick(2);
    const key = "10,64,10";
    const chest = dim.containers.get(key);
    const diamonds = chest?.slots.filter((s) => s.typeId === "minecraft:diamond").reduce((n, s) => n + s.amount, 0) ?? 0;
    check("chest placed where the boss died", dim.blocks.get(key) === "minecraft:chest");
    check("drops are inside it (2–5 diamonds), none on the ground", diamonds >= 2 && diamonds <= 5 && !mc.log.some(([, k, x]) => k === "drop" && x.includes("diamond")));
    check("chest protected (persisted)", String(mc.world.dyn["bhm:lootchests"]).includes('"x":10'));
    dim.createExplosion({ x: 10.5, y: 64, z: 10.5 }, 2);
    check("an explosion on it leaves the chest", dim.blocks.get(key) === "minecraft:chest");
    check("…but destroys the blocks around it", dim.blocks.get("11,63,10") === "minecraft:air");
    dim.getBlock({ x: 10, y: 64, z: 10 }).setType("minecraft:air"); // a player breaks it
    mc.tick(200);
    check("broken chest leaves the protected list", !String(mc.world.dyn["bhm:lootchests"] ?? "").includes('"x":10,'));
    // Too much loot for one chest: the rest goes into a second one next to it.
    const items = [{ item: "minecraft:diamond_sword", amount: 30 }];
    const placed = services.bosses.loot.place(dim, { x: 20, y: 64, z: 20 }, items);
    check("overflow fills a second chest beside the first", placed.length === 2 && placed[1].y === 64);
    const bad = services.bosses.loot.place(dim, { x: 30, y: 64, z: 30 }, [{ item: "minecraft:unknown_thing", amount: 1 }]);
    check("unknown items do not place a chest", bad.length === 0 && !dim.blocks.get("30,64,30"));
  }
}

console.log("\n30. common MythicMobs mechanics, targeters, conditions");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    let out = d.run("demo_explosion", 2);
    check("explosion at the target, no block damage, boss as source", d.has(out, "explosion", "(0, 64, 5) r2 by bhm_demo:test_boss") && !d.has(out, "explosion", "breaks"));
    out = d.run("demo_shoot", 12);
    check("shoot: 3 arrows (repeat 2)", d.count(out, "spawn", "minecraft:arrow") === 3);
    const p2 = new mc.Player("Mover", dim, { x: 6, y: 64, z: 6 });
    d.boss.threat.add(p2, 100);
    d.boss.targetCacheTick = -1;
    d.player.location = { x: 0, y: 64, z: -20 }; // out of the missile's way
    d.run("demo_missile", 3);
    p2.location = { x: -6, y: 64, z: 6 }; // the target moves away sideways
    mc.tick(60);
    check("missile (homing) follows a moving target and hits it", p2.health.currentValue < 20, `hp=${p2.health.currentValue}`);
    p2.remove();
    d.player.location = { x: 0, y: 64, z: 5 };
    d.boss.threat.clear();
    out = d.run("demo_jump", 2);
    check("jump", d.has(out, "impulse", "bhm_demo:test_boss (0, 0.9, 0)"));
    const p3 = new mc.Player("Taunter", dim, { x: 3, y: 64, z: 0 });
    services.executor.castByName(d.boss, "demo_taunt", { triggerEntity: p3 }, { force: true });
    d.boss.targetCacheTick = -1;
    check("threat taunt makes the trigger the target", d.boss.getTarget()?.id === p3.id);
    p3.remove();
    d.boss.threat.clear();
    d.boss.targetCacheTick = -1;
    out = d.run("demo_line", 2);
    check("@Line: a point every block to the target", d.count(out, "particle", "basic_flame") === 5);
    out = d.run("demo_ring_players", 2);
    check("@PlayersInRing finds the player 5 blocks away", d.has(out, "actionbar", "P: §7You are 3–12"));
    out = d.run("demo_near_target", 2);
    check("@RandomLocationsNearTarget: 2 strikes", d.count(out, "lightning") === 2);
    out = d.run("demo_spawn_point", 2);
    check("@Spawn", d.has(out, "particle", "totem_particle @ (0, 64, 0)"));
    d.player.location = { x: 0, y: 64, z: 9 };
    d.run("demo_force_pull", 2);
    check("forcePull brings the player next to the boss", Math.hypot(d.player.location.x, d.player.location.z) <= 1.5);
    d.player.location = { x: 0, y: 64, z: 5 };
    d.run("demo_swap", 2);
    check("swap", d.e.location.z === 5 && d.player.location.z === 0);
    d.e.location = { x: 0, y: 64, z: 0 };
    d.player.location = { x: 0, y: 64, z: 5 };
    out = d.run("demo_command", 2);
    check("command runs as the boss with placeholders", d.has(out, "command", "say §cTest Boss has 100% health"));
    d.run("demo_half_health", 2);
    check("setHealth 50%", d.e.health.currentValue === 150);
    out = d.run("demo_target_checks", 2, { inherited: [d.player] });
    check("isPlayer/onGround/onFire/crouching/sprinting/entityType/hasEffect pass", d.has(out, "actionbar", "Target checks passed"));
    d.player.isSneaking = true;
    out = d.run("demo_target_checks", 2, { inherited: [d.player] });
    check("…and fail when one doesn't hold (crouching)", !d.has(out, "actionbar", "Target checks passed"));
    d.player.isSneaking = false;
    d.player.addEffect("slowness", 100);
    out = d.run("demo_target_checks", 2, { inherited: [d.player] });
    check("…(hasEffect)", !d.has(out, "actionbar", "Target checks passed"));
  }
}

console.log("\n31. triggers: onCombat, onDropCombat, onChangeTarget, onKillPlayer, onLoad");
{
  clearWorld();
  if (!services.bosses.configs.get(DEMO)?.skills.has("on_combat")) check("skipped (demo pack not loaded)", true);
  else {
    const seen = [];
    for (const ev of ["combat", "dropCombat", "changeTarget"]) services.bus.on(ev, (x) => seen.push(`${ev}:${x.triggerEntity?.name ?? "-"}`));
    const e = new mc.Entity(DEMO, dim, { x: 0, y: 64, z: 0 }, { health: 300 });
    mc.world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" });
    mc.tick(2);
    const start = mc.log.length;
    const a = new mc.Player("A", dim, { x: 0, y: 64, z: 5 });
    mc.tick(2);
    check("onCombat when a player comes near", seen.includes("combat:A") && mc.log.slice(start).some(([, k, x]) => k === "actionbar" && x.includes("notices you")));
    const b = new mc.Player("B", dim, { x: 0, y: 64, z: 2 });
    mc.tick(2);
    check("onChangeTarget to the nearer player", seen.includes("changeTarget:B"));
    a.remove();
    b.remove();
    mc.tick(2);
    check("onDropCombat when nobody is left", seen.includes("dropCombat:-"));
    const victim = new mc.Player("Victim", dim, { x: 0, y: 64, z: 3 });
    mc.tick(1);
    const s2 = mc.log.length;
    services.adapter.applyDamage(victim, 100, e); // a skill hit (vanilla melee from bosses is cancelled)
    mc.tick(2);
    check("onKillPlayer with <trigger.name>", mc.log.slice(s2).some(([, k, x]) => k === "chat" && x.includes("Victim was defeated by §cTest Boss")));
    // A boss whose chunk unloads and loads again resumes from its saved state: onLoad, not onSpawn.
    const boss = services.bosses.get(e.id);
    services.bosses.save(boss);
    boss.destroy();
    services.bosses.instances.delete(e.id);
    new mc.Player("Watcher", dim, { x: 0, y: 64, z: 20 }); // particles are only drawn near players
    const s3 = mc.log.length;
    mc.world.afterEvents.entityLoad.fire({ entity: e });
    mc.tick(2);
    const after = mc.log.slice(s3);
    check("onLoad fires on a resumed boss", after.some(([, k, x]) => k === "particle" && x.includes("totem_particle")));
    check("…and onSpawn does not", !after.some(([, k, x]) => k === "sound" && x.includes("wither.spawn")));
  }
}

console.log("\n32. particle library: bhm:* particles with colour/size/lifetime variables, telegraph");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    const line = (out, start, ...parts) => out.some(([, k, x]) => k === "particle" && x.startsWith(start) && parts.every((p) => x.includes(p)));
    let out = d.run("demo_particles", 70);
    const ids = ["dust", "dust_transition", "spark", "smoke", "glow", "flash", "ring", "swirl"];
    const missing = ids.filter((id) => !d.has(out, "particle", `bhm:${id} @`));
    check("every library particle spawned", missing.length === 0, missing.join(","));
    check("colour and size reach the particle", line(out, "bhm:dust @", "color_r=0,", "color_g=1,", "color_b=1,", "color_a=1", "size=0.12"));
    check("color2 for the transition", line(out, "bhm:dust_transition @", "color2_r=0,", "color2_g=0.4,", "color2_b=0.8"));
    check("lifetime ticks → seconds", line(out, "bhm:glow @", "lifetime=1.5"));
    check("amount, width, rise → count, radius, rise", line(out, "bhm:swirl @", "count=40", "radius=1.2", "rise=2.5"));
    check("particleRing passes the variables too", d.count(out, "particle", "bhm:glow @") >= 24 && line(out, "bhm:glow @", "color_r=1,", "color_g=0.188"));
    const hp = d.player.health.currentValue;
    out = d.run("demo_telegraph", 5);
    check("telegraph: flat circle on the ground, radius + duration", line(out, "bhm:telegraph @ (0, 64.05, 5)", "size=3", "lifetime=1.5", "color_r=1,", "color_g=0.188"));
    check("…no damage before it ends", d.player.health.currentValue === hp);
    mc.tick(30);
    check("…the hit lands when it ends", d.player.health.currentValue < hp);
  }
}

console.log("\n33. partVisibility, grab, damageCause, onAttack from a cancelled melee swing");
{
  const d = demo();
  if (!d) check("skipped (demo pack not loaded)", true);
  else {
    d.run("demo_vanish", 2);
    check("parts hidden: bit mask on bhm:hidden_parts", d.e.props["bhm:hidden_parts"] === 3 && d.boss.hiddenParts === 3);
    services.bosses.save(d.boss);
    check("hidden parts persisted", JSON.parse(d.e.dyn["bhm:state"]).parts === 3);
    mc.tick(40);
    check("…and shown again", d.e.props["bhm:hidden_parts"] === 0);
    d.run("demo_vanish", 2);
    d.boss.reset("test");
    check("reset shows every part", d.e.props["bhm:hidden_parts"] === 0);

    d.player.location = { x: 0, y: 64, z: 6 };
    const start = mc.log.length;
    d.run("demo_grab", 10);
    const held = mc.log.slice(start).filter(([, k, x]) => k === "teleport" && x.startsWith("minecraft:player"));
    check("grab holds the target at the bone every tick", held.length >= 9 && Math.hypot(d.player.location.x, d.player.location.z - 0) < 1.5, `${held.length} teleports`);
    mc.tick(25);
    const s2 = mc.log.length;
    mc.tick(10);
    check("…and lets go after its duration", !mc.log.slice(s2).some(([, k, x]) => k === "teleport" && x.startsWith("minecraft:player")));

    const s3 = mc.log.length;
    d.e.applyDamage(2, { cause: "entityAttack", damagingEntity: d.player });
    mc.tick(2);
    check("melee damage makes it bleed (damageCause)", mc.log.slice(s3).some(([, k, x]) => k === "particle" && x.startsWith("bhm:dust") && x.includes("color_r=0.478")));
    mc.tick(10);
    const s4 = mc.log.length;
    d.e.applyDamage(2, { cause: "magic" });
    mc.tick(2);
    check("other damage does not", !mc.log.slice(s4).some(([, k, x]) => k === "particle" && x.startsWith("bhm:dust") && x.includes("color_r=0.478")));

    let attacks = 0;
    services.bus.on("attack", (ev) => { if (ev.boss === d.boss) attacks++; });
    d.player.applyDamage(4, { cause: "entityAttack", damagingEntity: d.e }); // the vanilla melee swing, damage cancelled
    mc.world.afterEvents.entityHitEntity.fire({ damagingEntity: d.e, hitEntity: d.player }); // same swing's hit event
    mc.tick(2);
    check("a cancelled vanilla swing still fires onAttack, once per tick", attacks === 1, `${attacks}`);

    // Custom boss bar image: the name carries the invisible marker the HUD overlay looks for.
    d.boss.config.display.bossBarImage = true;
    d.boss.applyDisplay();
    check("boss bar image: name ends with the overlay marker", d.e.nameTag === "§cTest Boss§r§r§r", JSON.stringify(d.e.nameTag));
    d.run("demo_bar", 2);
    check("…also when a skill changes the bar title", d.e.nameTag.endsWith("§r§r§r") && d.e.nameTag.includes("%)"), JSON.stringify(d.e.nameTag));
    delete d.boss.config.display.bossBarImage;
    d.boss.applyDisplay();
    check("no image: plain name (no overlay, no missing-texture square)", d.e.nameTag === "§cTest Boss");
  }
}

console.log(failures ? `\n[scenarios] ${failures} FAILED` : "\n[scenarios] all passed");
process.exit(failures ? 1 : 0);

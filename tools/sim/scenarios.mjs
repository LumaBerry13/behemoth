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
  const victim = before.find((t) => t !== "bhm_demo:test_boss" && t !== "bhm_demo:minion") ?? "bhm_demo:test_boss";
  mc.sim.missingTypes.add(victim);
  reloadFramework();
  check(`${victim} is not registered after its pack was removed`, !services.bosses.configs.has(victim));
  const index = JSON.parse(mc.world.dyn["bhm:cache"] ?? "{}");
  const packOf = Object.entries(index).find(([, e]) => e.bosses.includes(victim));
  check("its cache entry was deleted", !packOf);
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
  mc.sim.missingTypes.delete(victim);
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

console.log(failures ? `\n[scenarios] ${failures} FAILED` : "\n[scenarios] all passed");
process.exit(failures ? 1 : 0);

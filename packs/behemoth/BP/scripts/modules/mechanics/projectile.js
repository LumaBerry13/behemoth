// Scripted projectile (MythicMobs `projectile`): a point flies from the caster
// (or `origin`) toward each target (or `toward`), drawn by `particle` and/or a
// `bullet` entity that the framework moves every tick (e.g. a thrown sword
// model from the boss pack: give it no AI, no gravity, no collision). It runs
// skills at its position, which they see as @Origin and as their inherited
// target:
//   onStart  when it is launched
//   onTick   every `tickInterval` ticks while flying (modifyProjectile works here)
//   onHit    on each entity it hits (inherited target = that entity)
//   onEnd    where it stops (hit, block, range or time limit)
// Bullets are bound to the boss (removed if it dies) and removed when the
// projectile ends. Projectiles keep flying when the casting skill ends; the
// boss dying or resetting stops them. homing (0-1) steers it toward a moving
// entity target every tick (MythicMobs missile).
// o: { particle?, bullet?, speed?=0.8 (blocks/tick), gravity?=0, inertia?=1,
//      range?=24, maxTicks?=200, radius?=0.8, verticalRadius?=radius,
//      startY?=1.5, startForward?=0, startSide?=0, targetY?, origin?, toward?,
//      hugSurface?=false, stopAtEntity?=true, stopAtBlock?=true,
//      hitPlayers?=true, hitNonPlayers?=false, tickInterval?=1, homing?=0,
//      onStart?, onTick?, onHit?, onEnd? }
import { normalize, rotateYaw } from "../../core/vec.js";

const SKILL_KEYS = ["onStart", "onTick", "onHit", "onEnd"];

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "projectile",
  defaultTargeter: "@target",
  validate(o, vctx) {
    const errors = [];
    for (const k of SKILL_KEYS) {
      if (o[k] !== undefined && (typeof o[k] !== "string" || !vctx.config.skills[o[k]])) errors.push(`\`${k}\` skill "${o[k]}" is not defined`);
    }
    if (o.particle === undefined && o.bullet === undefined && o.onTick === undefined) errors.push("needs `particle`, `bullet` or `onTick`");
    if (o.bullet !== undefined && (typeof o.bullet !== "string" || !o.bullet.includes(":"))) errors.push("`bullet` must be a namespaced entity id");
    for (const k of ["speed", "range", "maxTicks", "radius", "verticalRadius", "tickInterval"]) {
      if (o[k] !== undefined && (typeof o[k] !== "number" || o[k] <= 0)) errors.push(`\`${k}\` must be > 0`);
    }
    if (o.homing !== undefined && (typeof o.homing !== "number" || o.homing < 0 || o.homing > 1)) errors.push("`homing` must be 0–1");
    for (const k of ["gravity", "inertia", "startY", "startForward", "startSide", "targetY"]) {
      if (o[k] !== undefined && typeof o[k] !== "number") errors.push(`\`${k}\` must be a number`);
    }
    for (const k of ["origin", "toward"]) {
      if (o[k] !== undefined) for (const e of vctx.checkTargeter(o[k])) errors.push(`\`${k}\`: ${e}`);
    }
    return errors;
  },
  execute(ctx, targets, o) {
    const origin = o.origin ? ctx.services.executor.resolveTargeter(ctx, o.origin)[0] : undefined;
    const toward = o.toward ? ctx.services.executor.resolveTargeter(ctx, o.toward)[0] : undefined;
    for (const t of targets) launch(ctx, toward ?? t, o, origin);
  },
};

/**
 * @param {import("../../types/config").SkillContext} ctx
 * @param {import("../../types/config").Target} target
 * @param {Record<string, any>} o
 * @param {import("../../types/config").Target | undefined} originTarget
 */
function launch(ctx, target, o, originTarget) {
  const a = ctx.services.adapter;
  const { scheduler, executor, bosses } = ctx.services;
  const boss = ctx.boss;
  const token = boss.token; // outlives the casting skill; cancelled on death / reset
  const dim = boss.dimension;
  const yaw = a.getYaw(boss.entity);

  /** @type {{ x: number, y: number, z: number }} */
  let start;
  if (originTarget) start = { ...a.locOf(originTarget) };
  else {
    const l = boss.location;
    const off = rotateYaw({ x: o.startSide ?? 0, y: 0, z: o.startForward ?? 0 }, yaw);
    start = { x: l.x + off.x, y: l.y + (o.startY ?? 1.5), z: l.z + off.z };
  }
  const goalBase = a.isEntity(target) && o.targetY === undefined ? a.getHeadLocation(target) : a.locOf(target);
  const goal = { x: goalBase.x, y: goalBase.y + (o.targetY ?? 0), z: goalBase.z };
  let dir = normalize({ x: goal.x - start.x, y: o.hugSurface ? 0 : goal.y - start.y, z: goal.z - start.z });
  if (!Number.isFinite(dir.x) || (dir.x === 0 && dir.y === 0 && dir.z === 0)) dir = rotateYaw({ x: 0, y: 0, z: 1 }, yaw);

  const speed = o.speed ?? 0.8;
  /** @type {import("../../types/config").ProjectileHandle} */
  const p = {
    pos: start,
    vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
    speed,
    gravity: o.gravity ?? 0,
    inertia: o.inertia ?? 1,
    radius: o.radius ?? 0.8,
    verticalRadius: o.verticalRadius ?? o.radius ?? 0.8,
    range: o.range ?? 24,
    travelled: 0,
    ticks: 0,
    ended: false,
    setSpeed(v) {
      const cur = Math.hypot(this.vel.x, this.vel.y, this.vel.z) || 1;
      const k = v / cur;
      this.vel = { x: this.vel.x * k, y: this.vel.y * k, z: this.vel.z * k };
      this.speed = v;
    },
  };
  const maxTicks = o.maxTicks ?? 200;
  const tickInterval = o.tickInterval ?? 1;
  const hit = new Set();

  const bullet = o.bullet ? a.spawnEntity(dim, o.bullet, start) : undefined;
  if (bullet) {
    a.addTag(bullet, "bhm_summon");
    a.addTag(bullet, "bhm_projectile");
    boss.boundSummons.add(bullet.id);
    bosses.trackTemporary(bullet, maxTicks + 40);
  }

  /** @param {string} skill @param {import("../../types/config").Target[]} inherited @param {import("@minecraft/server").Entity} [trigger] */
  const castAt = (skill, inherited, trigger) =>
    executor.castByName(boss, skill, { triggerEntity: trigger, data: ctx.data },
      { force: true, inherited, origin: a.location(p.pos), projectile: p, skillVars: ctx.skillVars });

  const cleanup = () => {
    if (!bullet) return;
    boss.boundSummons.delete(bullet.id);
    a.remove(bullet);
  };
  const end = () => {
    if (p.ended) return;
    p.ended = true;
    cleanup();
    if (o.onEnd && !boss.destroyed) castAt(o.onEnd, [a.location(p.pos)]);
  };

  if (o.onStart) castAt(o.onStart, [a.location(p.pos)]);

  const step = () => {
    if (p.ended) return;
    if (boss.destroyed || token.cancelled) {
      p.ended = true;
      cleanup();
      return;
    }
    const pos = p.pos;
    if (o.homing && a.isEntity(target) && target.isValid) {
      // Turn part of the way toward the target, keeping the speed.
      const h = a.getHeadLocation(target);
      const want = normalize({ x: h.x - pos.x, y: h.y - pos.y, z: h.z - pos.z });
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || p.speed;
      const k = o.homing;
      const mixed = normalize({ x: p.vel.x / sp * (1 - k) + want.x * k, y: p.vel.y / sp * (1 - k) + want.y * k, z: p.vel.z / sp * (1 - k) + want.z * k });
      p.vel = { x: mixed.x * sp, y: mixed.y * sp, z: mixed.z * sp };
    }
    pos.x += p.vel.x;
    pos.y += p.vel.y;
    pos.z += p.vel.z;
    p.vel.y -= p.gravity;
    if (p.inertia !== 1) p.vel = { x: p.vel.x * p.inertia, y: p.vel.y * p.inertia, z: p.vel.z * p.inertia };
    if (o.hugSurface) pos.y = a.surfaceY(dim, pos) + 0.1;
    p.travelled += Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    p.ticks++;

    if (o.particle) a.spawnParticles(dim, o.particle, [pos]);
    if (bullet?.isValid) a.teleport(bullet, pos, { x: pos.x + p.vel.x, y: pos.y + p.vel.y, z: pos.z + p.vel.z });
    if (o.onTick && p.ticks % tickInterval === 0) castAt(o.onTick, [a.location(pos)]);
    if (p.ended) return; // an onTick skill may end it

    const vr = p.verticalRadius;
    for (const e of a.getEntities(dim, { location: pos, maxDistance: p.radius + 3, excludeTags: ["bhm_summon"] })) {
      if (e.id === boss.id || hit.has(e.id) || !a.hasHealth(e) || bosses.get(e.id)) continue;
      const isPlayer = a.isPlayer(e);
      if (isPlayer ? o.hitPlayers === false || !a.isTargetablePlayer(e) : !o.hitNonPlayers) continue;
      const head = a.getHeadLocation(e);
      if (pos.y < e.location.y - vr || pos.y > head.y + vr) continue;
      if (Math.hypot(e.location.x - pos.x, e.location.z - pos.z) > p.radius + 0.3) continue;
      hit.add(e.id);
      if (o.onHit) castAt(o.onHit, [e], e);
      if (o.stopAtEntity !== false) return end();
    }
    if (o.stopAtBlock !== false && !o.hugSurface && a.isSolidAt(dim, pos)) return end();
    if (p.travelled >= p.range || p.ticks >= maxTicks) return end();
    scheduler.after(1, step, token);
  };
  step();
}

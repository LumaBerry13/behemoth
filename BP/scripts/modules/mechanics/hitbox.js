// Damage volume (MythicMobs `totem`). Living entities touching it get `onHit`
// cast on them (forced, inherited target = the hit entity). Each entity can be
// hit by the same `onHit` skill at most once per `interval` ticks.
//
// Shapes:
//  - default: cylinder at each target location (radius `hr`, half-height `vr`)
//  - with `to: "<bone>"`: capsule of radius `hr` from each target location to
//    that baked bone (e.g. hilt → blade tip), so the hit follows the weapon.
//
// o: { onHit, hr?=1, vr?=1, to?, hitPlayers?=true, hitNonPlayers?=false, interval?=20, draw?=false }
const DRAW_PARTICLE = "minecraft:villager_happy";
const BODY_RADIUS = 0.3; // approximate half-width of a player/mob body

/** @typedef {{ x: number, y: number, z: number }} V3 */

/**
 * Smallest distance between segments p1-q1 and p2-q2.
 * @param {V3} p1 @param {V3} q1 @param {V3} p2 @param {V3} q2
 */
function segmentDistance(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (/** @type {V3} */ a, /** @type {V3} */ b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
  let s;
  let t;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0;
    t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      t = 0;
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "hitbox",
  defaultTargeter: "@SelfLocation",
  validate(o, vctx) {
    const errors = [];
    if (typeof o.onHit !== "string" || !vctx.config.skills[o.onHit]) errors.push(`\`onHit\` skill "${o.onHit}" is not defined`);
    for (const k of ["hr", "vr"]) {
      if (o[k] !== undefined && (typeof o[k] !== "number" || o[k] <= 0)) errors.push(`\`${k}\` must be a positive number`);
    }
    if (o.to !== undefined && typeof o.to !== "string") errors.push("`to` must be a bone name");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const log = ctx.services.log;
    const boss = ctx.boss;
    const now = ctx.services.scheduler.tick;
    const hr = o.hr ?? 1;
    const vr = o.vr ?? 1;
    const interval = o.interval ?? 20;
    const end = o.to ? boss.getBonePosition(o.to) : undefined;
    let hits = boss.hitCooldowns.get(o.onHit);
    if (!hits) boss.hitCooldowns.set(o.onHit, (hits = new Map()));

    for (const t of targets) {
      const c = a.locOf(t);
      if (o.draw || log.isDebug) {
        const pts = [c];
        if (end) for (const f of [0.25, 0.5, 0.75, 1]) pts.push({ x: c.x + (end.x - c.x) * f, y: c.y + (end.y - c.y) * f, z: c.z + (end.z - c.z) * f });
        a.spawnParticles(boss.dimension, DRAW_PARTICLE, pts);
      }
      const reach = end ? Math.hypot(end.x - c.x, end.y - c.y, end.z - c.z) : 0;
      const near = a.getEntities(boss.dimension, {
        location: c,
        maxDistance: reach + Math.hypot(hr, vr) + 3, // generous; exact test below
        excludeTags: ["mb_summon"],
      });
      for (const e of near) {
        if (e.id === boss.id || !a.hasHealth(e)) continue;
        const isPlayer = a.isPlayer(e);
        if (isPlayer ? o.hitPlayers === false || !a.isTargetablePlayer(e) : !o.hitNonPlayers) continue;
        if ((hits.get(e.id) ?? 0) > now) continue;

        const feet = e.location;
        const head = a.getHeadLocation(e);
        if (end) {
          if (segmentDistance(c, end, feet, { x: feet.x, y: head.y, z: feet.z }) > hr + BODY_RADIUS) continue;
        } else {
          // Cylinder vs. entity body (feet → head).
          if (Math.hypot(feet.x - c.x, feet.z - c.z) > hr + BODY_RADIUS) continue;
          const closestY = Math.max(feet.y, Math.min(c.y, head.y));
          if (Math.abs(closestY - c.y) > vr) continue;
        }

        hits.set(e.id, now + interval);
        const before = log.isDebug ? a.getHealth(e).current : 0;
        ctx.services.executor.castByName(boss, o.onHit, { triggerEntity: e, data: ctx.data }, { force: true, inherited: [e] });
        if (log.isDebug) log.debug(`hitbox ${o.onHit}: hit ${e.typeId} hp ${before} → ${a.getHealth(e).current}`);
      }
    }
  },
};

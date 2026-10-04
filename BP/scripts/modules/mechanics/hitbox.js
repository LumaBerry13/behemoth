// Damage volume at each target location (MythicMobs `totem`). Living entities
// whose body overlaps the cylinder (radius `hr`, half-height `vr`) get `onHit`
// cast on them (forced, inherited target = the hit entity). Each entity can be
// hit by the same `onHit` skill at most once per `interval` ticks.
// o: { onHit, hr?=1, vr?=1, hitPlayers?=true, hitNonPlayers?=false, interval?=20, draw?=false }
const DRAW_PARTICLE = "minecraft:villager_happy";

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
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const boss = ctx.boss;
    const now = ctx.services.scheduler.tick;
    const hr = o.hr ?? 1;
    const vr = o.vr ?? 1;
    const interval = o.interval ?? 20;
    let hits = boss.hitCooldowns.get(o.onHit);
    if (!hits) boss.hitCooldowns.set(o.onHit, (hits = new Map()));

    for (const t of targets) {
      const c = a.locOf(t);
      if (o.draw || ctx.services.log.isDebug) a.spawnParticles(boss.dimension, DRAW_PARTICLE, [c]);
      const near = a.getEntities(boss.dimension, {
        location: c,
        maxDistance: Math.hypot(hr, vr) + 3, // generous; exact test below
        excludeTags: ["mb_summon"],
      });
      for (const e of near) {
        if (e.id === boss.id || !a.hasHealth(e)) continue;
        const isPlayer = a.isPlayer(e);
        if (isPlayer ? o.hitPlayers === false || !a.isTargetablePlayer(e) : !o.hitNonPlayers) continue;
        if ((hits.get(e.id) ?? 0) > now) continue;

        // Cylinder vs. entity body (feet → head).
        const feet = e.location;
        if (Math.hypot(feet.x - c.x, feet.z - c.z) > hr) continue;
        const head = a.getHeadLocation(e).y;
        const closestY = Math.max(feet.y, Math.min(c.y, head));
        if (Math.abs(closestY - c.y) > vr) continue;

        hits.set(e.id, now + interval);
        ctx.services.executor.castByName(boss, o.onHit, { triggerEntity: e, data: ctx.data }, { force: true, inherited: [e] });
      }
    }
  },
};

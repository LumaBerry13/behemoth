// Traces a straight line from the caster toward each target (MythicMobs
// raytraceto). The line stops at the first solid block (stopAtBlock), at the
// target point (stopAtTarget) or after maxDistance. `locationSkill` runs at the
// end point; `entitySkill` runs on every entity within width/2 of the line
// (players; other mobs with hitNonPlayers). Both skills see the end point as
// @Origin. `particle` draws the line every `spacing` blocks.
// o: { maxDistance?=32, startY?=1.5, width?=1, stopAtBlock?=true, stopAtTarget?=true,
//      locationSkill?, entitySkill?, hitPlayers?=true, hitNonPlayers?=false, particle?, spacing?=0.5 }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "rayTraceTo",
  defaultTargeter: "@target",
  validate(o, vctx) {
    const errors = [];
    for (const k of ["locationSkill", "entitySkill"]) {
      if (o[k] !== undefined && !vctx.config.skills[o[k]]) errors.push(`\`${k}\` skill "${o[k]}" is not defined`);
    }
    if (o.locationSkill === undefined && o.entitySkill === undefined && o.particle === undefined) errors.push("needs `locationSkill`, `entitySkill` or `particle`");
    for (const k of ["maxDistance", "width", "spacing"]) if (o[k] !== undefined && (typeof o[k] !== "number" || o[k] <= 0)) errors.push(`\`${k}\` must be > 0`);
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const { executor, bosses } = ctx.services;
    const boss = ctx.boss;
    const dim = boss.dimension;
    const l = boss.location;
    const from = { x: l.x, y: l.y + (o.startY ?? 1.5), z: l.z };
    const maxDistance = o.maxDistance ?? 32;
    const half = (o.width ?? 1) / 2;

    for (const t of targets) {
      const goal = a.locOf(t);
      const d = { x: goal.x - from.x, y: goal.y - from.y, z: goal.z - from.z };
      const len = Math.hypot(d.x, d.y, d.z);
      if (len < 1e-3) continue;
      const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
      let dist = o.stopAtTarget === false ? maxDistance : Math.min(len, maxDistance);
      if (o.stopAtBlock !== false) {
        const hit = a.raycastBlock(dim, from, dir, dist);
        if (hit) dist = Math.hypot(hit.x - from.x, hit.y - from.y, hit.z - from.z);
      }
      const end = { x: from.x + dir.x * dist, y: from.y + dir.y * dist, z: from.z + dir.z * dist };
      const endLoc = a.location(end);

      if (o.particle) {
        const step = o.spacing ?? 0.5;
        const pts = [];
        for (let s = 0; s <= dist; s += step) pts.push({ x: from.x + dir.x * s, y: from.y + dir.y * s, z: from.z + dir.z * s });
        a.spawnParticles(dim, o.particle, pts);
      }

      if (o.entitySkill) {
        const mid = { x: (from.x + end.x) / 2, y: (from.y + end.y) / 2, z: (from.z + end.z) / 2 };
        for (const e of a.getEntities(dim, { location: mid, maxDistance: dist / 2 + half + 2, excludeTags: ["bhm_summon"] })) {
          if (e.id === boss.id || !a.hasHealth(e) || bosses.get(e.id)) continue;
          const isPlayer = a.isPlayer(e);
          if (isPlayer ? o.hitPlayers === false || !a.isTargetablePlayer(e) : !o.hitNonPlayers) continue;
          const c = e.location;
          const head = a.getHeadLocation(e);
          // Distance from the line to the entity's body (feet, middle, head).
          let best = Infinity;
          for (const y of [c.y, (c.y + head.y) / 2, head.y]) {
            const v = { x: c.x - from.x, y: y - from.y, z: c.z - from.z };
            const s = Math.max(0, Math.min(dist, v.x * dir.x + v.y * dir.y + v.z * dir.z));
            best = Math.min(best, Math.hypot(v.x - dir.x * s, v.y - dir.y * s, v.z - dir.z * s));
          }
          if (best > half + 0.4) continue;
          executor.castByName(boss, o.entitySkill, { triggerEntity: e, data: ctx.data },
            { force: true, inherited: [e], origin: endLoc, skillVars: ctx.skillVars });
        }
      }
      if (o.locationSkill) {
        executor.castByName(boss, o.locationSkill, { data: ctx.data }, { force: true, inherited: [endLoc], origin: endLoc, skillVars: ctx.skillVars });
      }
    }
  },
};

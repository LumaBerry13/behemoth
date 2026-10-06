// Scripted particle projectile (MythicMobs `projectile` / `missile` style): a
// point flies from the caster toward each target's position at cast time,
// drawing `particle`, and casts `onHit` (forced, inherited = the hit entity) on
// the first living entity within `radius`. Stops on a solid block or after
// `range` blocks. No custom entity needed. Runs on the skill's cancel token.
// o: { particle, onHit, speed?=0.8 (blocks/tick), range?=24, radius?=0.8,
//      gravity?=0, startY?=1.5, hitPlayers?=true, hitNonPlayers?=false, onEnd? }
import { normalize } from "../../core/vec.js";

const MAX_TICKS = 200;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "projectile",
  defaultTargeter: "@target",
  validate(o, vctx) {
    const errors = [];
    if (typeof o.particle !== "string") errors.push("`particle` is required");
    if (typeof o.onHit !== "string" || !vctx.config.skills[o.onHit]) errors.push(`\`onHit\` skill "${o.onHit}" is not defined`);
    if (o.onEnd !== undefined && !vctx.config.skills[o.onEnd]) errors.push(`\`onEnd\` skill "${o.onEnd}" is not defined`);
    if (o.speed !== undefined && (typeof o.speed !== "number" || o.speed <= 0)) errors.push("`speed` must be > 0");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const { scheduler, executor, bosses } = ctx.services;
    const boss = ctx.boss;
    const dim = boss.dimension;
    const speed = o.speed ?? 0.8;
    const range = o.range ?? 24;
    const radius = o.radius ?? 0.8;
    const gravity = o.gravity ?? 0;
    const start = boss.location;

    for (const t of targets) {
      const goal = a.isEntity(t) ? a.getHeadLocation(t) : a.locOf(t);
      const pos = { x: start.x, y: start.y + (o.startY ?? 1.5), z: start.z };
      const dir = normalize({ x: goal.x - pos.x, y: goal.y - pos.y, z: goal.z - pos.z });
      const vel = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
      let travelled = 0;
      let ticks = 0;

      const end = () => {
        if (o.onEnd) executor.castByName(boss, o.onEnd, { data: ctx.data }, { force: true, inherited: [a.location(pos)] });
      };
      const step = () => {
        if (boss.destroyed) return;
        pos.x += vel.x;
        pos.y += vel.y;
        pos.z += vel.z;
        vel.y -= gravity;
        travelled += speed;
        a.spawnParticles(dim, o.particle, [pos]);

        for (const e of a.getEntities(dim, { location: pos, maxDistance: radius + 1.5, excludeTags: ["bhm_summon"] })) {
          if (e.id === boss.id || !a.hasHealth(e) || bosses.get(e.id)) continue;
          const isPlayer = a.isPlayer(e);
          if (isPlayer ? o.hitPlayers === false || !a.isTargetablePlayer(e) : !o.hitNonPlayers) continue;
          const head = a.getHeadLocation(e);
          const cy = Math.max(e.location.y, Math.min(pos.y, head.y));
          if (Math.hypot(e.location.x - pos.x, cy - pos.y, e.location.z - pos.z) > radius + 0.3) continue;
          executor.castByName(boss, o.onHit, { triggerEntity: e, data: ctx.data }, { force: true, inherited: [e] });
          return; // first hit stops the projectile
        }
        const block = a.getBlockTypeId(dim, pos);
        const solid = block !== "" && block !== "minecraft:air" && !block.includes("water") && !block.includes("lava")
          && !block.includes("grass") && !block.includes("flower");
        if (solid || travelled >= range || ++ticks >= MAX_TICKS) return end();
        scheduler.after(1, step, ctx.token);
      };
      step();
    }
  },
};

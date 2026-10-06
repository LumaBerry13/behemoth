// Shoots a vanilla projectile entity (arrow, small_fireball, snowball, wither
// skull...) from the caster toward each target (MythicMobs shoot). The
// projectile's own Bedrock behaviour deals the damage; for scripted hits use
// `projectile`.
// o: { type?="minecraft:arrow", velocity?=1.5 (blocks/tick), startY?=1.5, spread?=0 }
import { normalize } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "shoot",
  defaultTargeter: "@target",
  validate(o) {
    const errors = [];
    if (o.type !== undefined && (typeof o.type !== "string" || !o.type.includes(":"))) errors.push("`type` must be a namespaced entity id");
    if (o.velocity !== undefined && (typeof o.velocity !== "number" || o.velocity <= 0)) errors.push("`velocity` must be > 0");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const l = ctx.boss.location;
    const from = { x: l.x, y: l.y + (o.startY ?? 1.5), z: l.z };
    const v = o.velocity ?? 1.5;
    const spread = o.spread ?? 0;
    for (const t of targets) {
      const goal = a.isEntity(t) ? a.getHeadLocation(t) : a.locOf(t);
      const d = normalize({
        x: goal.x - from.x + (rng.next() - 0.5) * spread,
        y: goal.y - from.y + (rng.next() - 0.5) * spread,
        z: goal.z - from.z + (rng.next() - 0.5) * spread,
      });
      a.shootProjectile(ctx.boss.dimension, o.type ?? "minecraft:arrow", from, { x: d.x * v, y: d.y * v, z: d.z * v }, ctx.caster);
    }
  },
};

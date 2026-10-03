// Summons entities around each target location, with per-boss and global caps.
// o: { type, amount?=1, radius?=2, cap?=8 }
const GLOBAL_CAP = 64;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "summon",
  defaultTargeter: "@SelfLocation",
  validate(o) {
    const errors = [];
    if (typeof o.type !== "string" || !o.type.includes(":")) errors.push("`type` must be a namespaced entity id");
    if (o.amount !== undefined && (!Number.isInteger(o.amount) || o.amount < 1)) errors.push("`amount` must be a positive integer");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const boss = ctx.boss;
    const cap = o.cap ?? 8;
    const radius = o.radius ?? 2;

    // Prune dead summons and count live ones across all bosses.
    let global = 0;
    for (const b of ctx.services.bosses.all()) {
      for (const id of b.summons) {
        if (a.getEntity(id)?.isValid) global++;
        else b.summons.delete(id);
      }
    }

    for (const t of targets) {
      const l = a.locOf(t);
      for (let i = 0; i < (o.amount ?? 1); i++) {
        if (boss.summons.size >= cap || global >= GLOBAL_CAP) return;
        const ang = rng.next() * Math.PI * 2;
        const r = rng.next() * radius;
        const e = a.spawnEntity(boss.dimension, o.type, { x: l.x + Math.cos(ang) * r, y: l.y, z: l.z + Math.sin(ang) * r });
        if (!e) continue;
        a.addTag(e, "mb_summon");
        boss.summons.add(e.id);
        global++;
      }
    }
  },
};

// Summons entities around each target location, with per-boss and global caps.
// Summons are bound to the boss by default: removed when it dies, despawns or
// resets (bind: false keeps them). Every summon remembers its summoner
// (@Parent). If `type` is a registered minion config, the framework drives it
// like any other Behemoth entity. facing: "caster" turns it the way the caster
// faces (slash / telegraph effects).
// o: { type, amount?=1, radius?=2, cap?=8, onSurface?=false, lifetime? (ticks), bind?=true, facing? }
const GLOBAL_CAP = 64;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "summon",
  defaultTargeter: "@SelfLocation",
  validate(o) {
    const errors = [];
    if (typeof o.type !== "string" || !o.type.includes(":")) errors.push("`type` must be a namespaced entity id");
    if (o.amount !== undefined && (!Number.isInteger(o.amount) || o.amount < 1)) errors.push("`amount` must be a positive integer");
    if (o.lifetime !== undefined && (!Number.isInteger(o.lifetime) || o.lifetime < 1)) errors.push("`lifetime` must be a positive integer (ticks)");
    if (o.facing !== undefined && o.facing !== "caster") errors.push('`facing` must be "caster"');
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const boss = ctx.boss;
    const dim = boss.dimension;
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
        const pos = { x: l.x + Math.cos(ang) * r, y: l.y, z: l.z + Math.sin(ang) * r };
        if (o.onSurface) pos.y = a.surfaceY(dim, pos);
        const e = a.spawnEntity(dim, o.type, pos);
        if (!e) continue;
        a.addTag(e, "bhm_summon");
        a.setDynamic(e, "bhm:parent", boss.id);
        if (o.facing === "caster") a.setRotation(e, 0, a.getYaw(ctx.caster));
        boss.summons.add(e.id);
        if (o.bind !== false) boss.boundSummons.add(e.id);
        if (o.lifetime) ctx.services.bosses.trackTemporary(e, o.lifetime);
        global++;
      }
    }
  },
};

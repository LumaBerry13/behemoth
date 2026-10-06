// @ThreatTable{limit=0} — players on the boss's threat table, highest threat
// first (valid, same dimension, within targetRange).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "ThreatTable",
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const boss = ctx.boss;
    const loc = boss.location;
    const out = [];
    for (const [id, value] of boss.threat.threat) {
      const e = a.getEntity(id);
      if (!e || !a.isTargetablePlayer(e) || e.dimension.id !== boss.dimension.id) continue;
      const l = e.location;
      if (Math.hypot(l.x - loc.x, l.y - loc.y, l.z - loc.z) > boss.targetRange) continue;
      out.push({ e, value });
    }
    out.sort((x, y) => y.value - x.value);
    const list = out.map((x) => x.e);
    return o.limit > 0 ? list.slice(0, o.limit) : list;
  },
};

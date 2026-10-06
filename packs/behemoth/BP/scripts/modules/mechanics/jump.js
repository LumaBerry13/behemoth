// Makes entity targets jump straight up (MythicMobs jump).
// o: { velocity?=0.8 } blocks/tick upward
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "jump",
  defaultTargeter: "@self",
  validate(o) {
    return o.velocity === undefined || typeof o.velocity === "number" ? [] : ["`velocity` must be a number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t)) a.push(t, { x: 0, y: o.velocity ?? 0.8, z: 0 });
  },
};

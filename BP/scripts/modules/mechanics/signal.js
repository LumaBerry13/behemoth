// Sends a signal (onSignal trigger) to this boss, or with `radius` to every
// framework boss within that many blocks (including this one).
// o: { signal, radius? }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "signal",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.signal === "string" && o.signal ? [] : ["`signal` name is required"];
  },
  execute(ctx, _targets, o) {
    const bosses = ctx.services.bosses;
    const me = ctx.boss;
    let list = [me];
    if (typeof o.radius === "number") {
      const l = me.location;
      list = bosses.all().filter((b) => b.dimension.id === me.dimension.id
        && Math.hypot(b.location.x - l.x, b.location.y - l.y, b.location.z - l.z) <= o.radius);
    }
    bosses.signal(list, o.signal, ctx.caster);
  },
};

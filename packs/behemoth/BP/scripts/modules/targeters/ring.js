// @Ring{radius=5;points=8;y=0} — locations evenly spaced on a circle around
// the caster (for summons, strikes, particles).
import { ring } from "../../core/vec.js";

/** @type {import("../../types/config").Targeter} */
export default {
  name: "Ring",
  validate(o) {
    return o.points === undefined || (Number.isInteger(o.points) && o.points > 0 && o.points <= 64) ? [] : ["`points` must be 1–64"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const l = ctx.boss.location;
    return ring({ x: l.x, y: l.y + (o.y ?? 0), z: l.z }, o.radius ?? 5, o.points ?? 8).map((p) => a.location(p));
  },
};

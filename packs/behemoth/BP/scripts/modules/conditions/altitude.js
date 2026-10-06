// altitude<2 — height of the target (default the caster) above the ground
// below it, in blocks (MythicMobs altitude).
import { compare } from "../../core/SkillParser.js";

/** @type {import("../../types/config").Condition} */
export default {
  name: "altitude",
  validate(args) {
    return args.op && typeof args.value === "number" ? [] : ["use the form altitude<2"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    const l = a.locOf(target);
    const dim = a.isEntity(target) ? target.dimension : ctx.boss.dimension;
    return compare(l.y - a.surfaceY(dim, l), args.op, Number(args.value));
  },
};

// distance<=4 — distance from the caster to its current target (in `targetIf`:
// to the target being tested). False if there is no target.
import { compare } from "../../core/SkillParser.js";
import { distance as dist } from "../../core/vec.js";

/** @type {import("../../types/config").Condition} */
export default {
  name: "distance",
  validate(args) {
    return args.op && typeof args.value === "number" ? [] : ["use the form distance<=4"];
  },
  test(ctx, target, args) {
    const t = target === ctx.caster ? ctx.boss.getTarget() : target;
    if (!t) return false;
    return compare(dist(ctx.boss.location, ctx.services.adapter.locOf(t)), args.op, Number(args.value));
  },
};

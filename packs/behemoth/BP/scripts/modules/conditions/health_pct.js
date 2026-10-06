// healthPct<50 — caster health as a percentage (0–100).
import { compare } from "../../core/SkillParser.js";

/** @type {import("../../types/config").Condition} */
export default {
  name: "healthPct",
  validate(args) {
    return args.op && typeof args.value === "number" ? [] : ["use the form healthPct<50"];
  },
  test(ctx, _target, args) {
    return compare(ctx.boss.healthPct(), args.op, Number(args.value));
  },
};

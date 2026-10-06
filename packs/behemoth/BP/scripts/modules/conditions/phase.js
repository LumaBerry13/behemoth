// phase==2, phase>=2 — the boss's current phase id.
import { compare } from "../../core/SkillParser.js";

/** @type {import("../../types/config").Condition} */
export default {
  name: "phase",
  validate(args) {
    return args.op && typeof args.value === "number" ? [] : ["use the form phase==2"];
  },
  test(ctx, _target, args) {
    return compare(ctx.boss.phase, args.op, Number(args.value));
  },
};

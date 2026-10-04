// height>=80 — the caster's Y coordinate.
import { compare } from "../../core/SkillParser.js";

/** @type {import("../../types/config").Condition} */
export default {
  name: "height",
  validate(args) {
    return args.op && typeof args.value === "number" ? [] : ["use the form height>=80"];
  },
  test(ctx, _target, args) {
    return compare(ctx.boss.location.y, args.op, Number(args.value));
  },
};

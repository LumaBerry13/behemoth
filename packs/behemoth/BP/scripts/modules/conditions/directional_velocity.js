// directionalVelocity{y=<-0.6} — the entity's velocity on each given axis
// matches (MythicMobs directionalvelocity). Each of x/y/z is a number (exact),
// "<n", "<=n", ">n", ">=n" or a range "a to b" / "atob" (blocks/tick).
import { compare } from "../../core/SkillParser.js";

const RANGE = /^\s*(-?[\d.]+)\s*to\s*(-?[\d.]+)\s*$/;
const OP = /^\s*(<=|>=|<|>|==|=)?\s*(-?[\d.]+)\s*$/;

/** @param {unknown} spec @returns {((v: number) => boolean) | undefined} */
function matcher(spec) {
  if (typeof spec === "number") return (v) => Math.abs(v - spec) < 1e-3;
  if (typeof spec !== "string") return undefined;
  const r = RANGE.exec(spec);
  if (r) return (v) => v >= Number(r[1]) && v <= Number(r[2]);
  const m = OP.exec(spec);
  if (!m) return undefined;
  const op = m[1] === "=" || !m[1] ? "==" : m[1];
  const n = Number(m[2]);
  return op === "==" ? (v) => Math.abs(v - n) < 1e-3 : (v) => compare(v, op, n);
}

/** @type {import("../../types/config").Condition} */
export default {
  name: "directionalVelocity",
  validate(args) {
    const axes = ["x", "y", "z"].filter((k) => args[k] !== undefined);
    if (!axes.length) return ["give at least one of x, y, z (e.g. y=<-0.6)"];
    return axes.filter((k) => !matcher(args[k])).map((k) => `cannot read ${k}="${args[k]}"`);
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    if (!a.isEntity(target)) return false;
    const v = a.getVelocity(target);
    for (const k of /** @type {const} */ (["x", "y", "z"])) {
      if (args[k] === undefined) continue;
      if (!matcher(args[k])?.(v[k])) return false;
    }
    return true;
  },
};

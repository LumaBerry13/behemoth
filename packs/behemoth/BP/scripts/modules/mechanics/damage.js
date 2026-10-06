// Deals flat damage to entity targets (see shared/deal_damage.js for
// damageMultiplier / ignoreDifficulty handling). The caster never damages itself.
// o: { amount, cause?="entityAttack" }
import { dealDamage } from "../shared/deal_damage.js";
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "damage",
  defaultTargeter: "@target",
  validate(o) {
    return typeof o.amount === "number" && o.amount > 0 ? [] : ["`amount` must be a positive number"];
  },
  execute(ctx, targets, o) {
    for (const t of targets) dealDamage(ctx, t, o.amount, o.cause);
  },
};

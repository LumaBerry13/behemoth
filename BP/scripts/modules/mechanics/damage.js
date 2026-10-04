// Deals flat damage to entity targets, scaled by config.stats.damageMultiplier
// (default 1). The caster never damages itself.
// Bedrock scales mob damage to players by difficulty (measured in-game: Easy
// turns 10 into 6 = x/2+1; Hard is x1.5). With config.stats.ignoreDifficulty the
// amount is pre-scaled so players take the configured value on Easy/Normal/Hard.
// o: { amount, cause?="entityAttack" }

/** Inverse of Bedrock's difficulty scaling for damage dealt to players. @param {number} a @param {string} difficulty */
function undoDifficulty(a, difficulty) {
  if (difficulty === "Easy") return a > 2 ? (a - 1) * 2 : a; // easy: min(x/2+1, x)
  if (difficulty === "Hard") return a / 1.5; // [VERIFY] hard multiplier
  return a;
}
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "damage",
  defaultTargeter: "@target",
  validate(o) {
    return typeof o.amount === "number" && o.amount > 0 ? [] : ["`amount` must be a positive number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const amount = o.amount * (ctx.boss.config.stats?.damageMultiplier ?? 1);
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id || !a.hasHealth(t)) continue;
      const before = ctx.services.log.isDebug ? a.getHealth(t).current : 0;
      const dealt = ctx.boss.config.stats?.ignoreDifficulty && a.isPlayer(t) ? undoDifficulty(amount, a.getDifficulty()) : amount;
      a.applyDamage(t, dealt, ctx.caster, o.cause ?? "entityAttack");
      if (ctx.services.log.isDebug) {
        ctx.services.log.debug(`damage ${amount} → ${t.typeId}: hp ${before} → ${a.getHealth(t).current}`);
      }
    }
  },
};

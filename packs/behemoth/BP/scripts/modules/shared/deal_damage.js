// Shared by damage-dealing mechanics (damage, percentDamage, projectile, ...).
// Applies config.stats.damageMultiplier and, with config.stats.ignoreDifficulty,
// undoes Bedrock's difficulty scaling for players (measured in-game: Easy turns
// 10 into 6 = x/2+1; Hard ×1.5 [VERIFY]). Never hurts the caster.

/** @param {number} a @param {string} difficulty */
function undoDifficulty(a, difficulty) {
  if (difficulty === "Easy") return a > 2 ? (a - 1) * 2 : a;
  if (difficulty === "Hard") return a / 1.5;
  return a;
}

/**
 * @param {import("../../types/config").SkillContext} ctx
 * @param {import("../../types/config").Target} target
 * @param {number} amount base amount (before damageMultiplier)
 * @param {string} [cause]
 * @returns {boolean} true if damage was applied
 */
export function dealDamage(ctx, target, amount, cause = "entityAttack") {
  const a = ctx.services.adapter;
  const log = ctx.services.log;
  if (!a.isEntity(target) || target.id === ctx.caster.id || !a.hasHealth(target)) return false;
  const stats = ctx.boss.config.stats;
  const scaled = amount * (stats?.damageMultiplier ?? 1);
  const dealt = stats?.ignoreDifficulty && a.isPlayer(target) ? undoDifficulty(scaled, a.getDifficulty()) : scaled;
  const before = log.isDebug ? a.getHealth(target).current : 0;
  const ok = a.applyDamage(target, dealt, ctx.caster, cause);
  if (log.isDebug) log.debug(`damage ${scaled} → ${target.typeId}: hp ${before} → ${a.getHealth(target).current}`);
  return ok;
}

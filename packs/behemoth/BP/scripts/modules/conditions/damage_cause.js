// damageCause{cause=entityAttack|projectile} — the damage that triggered this
// skill (onDamaged) has one of these Bedrock damage causes (MythicMobs
// damagecause). False when the skill was not started by damage.

/** @type {import("../../types/config").Condition} */
export default {
  name: "damageCause",
  validate(args) {
    return typeof (args.cause ?? args.value) === "string" ? [] : ["use the form damageCause{cause=entityAttack}"];
  },
  test(ctx, _target, args) {
    const data = /** @type {{ cause?: unknown } | undefined} */ (ctx.data);
    const cause = data && typeof data === "object" ? data.cause : undefined;
    if (typeof cause !== "string") return false;
    return String(args.cause ?? args.value).split(/[|,]/).map((s) => s.trim()).includes(cause);
  },
};

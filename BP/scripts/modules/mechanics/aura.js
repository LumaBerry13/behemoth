// Repeats a skill every `interval` ticks for `duration` ticks (MythicMobs
// `aura` with onTick). Each tick casts `onTick` (forced) with this line's
// targets inherited. Stops early if the parent skill is cancelled or the boss dies.
// o: { onTick, duration, interval?=1 }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "aura",
  defaultTargeter: "@self",
  validate(o, vctx) {
    const errors = [];
    if (typeof o.onTick !== "string" || !vctx.config.skills[o.onTick]) errors.push(`\`onTick\` skill "${o.onTick}" is not defined`);
    if (!Number.isInteger(o.duration) || o.duration < 1) errors.push("`duration` must be a positive integer (ticks)");
    if (o.interval !== undefined && (!Number.isInteger(o.interval) || o.interval < 1)) errors.push("`interval` must be a positive integer");
    return errors;
  },
  execute(ctx, targets, o) {
    const { scheduler, executor } = ctx.services;
    const boss = ctx.boss;
    const interval = o.interval ?? 1;
    const event = { triggerEntity: ctx.trigger, data: ctx.data };
    const fire = () => executor.castByName(boss, o.onTick, event, { force: true, inherited: targets });
    fire();
    for (let t = interval; t < o.duration; t += interval) scheduler.after(t, fire, ctx.token);
  },
};

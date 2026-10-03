// Switches the boss AI component group (design doc §5).
// o: { mode: "idle" | "chase" | "frozen", ticks? } — with ticks, reverts to the previous mode afterwards.
const MODES = ["idle", "chase", "frozen"];

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setAI",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    if (!MODES.includes(o.mode)) errors.push(`\`mode\` must be one of ${MODES.join("/")}`);
    if (o.ticks !== undefined && (!Number.isInteger(o.ticks) || o.ticks < 1)) errors.push("`ticks` must be a positive integer");
    return errors;
  },
  execute(ctx, _targets, o) {
    const boss = ctx.boss;
    const previous = boss.aiMode;
    const seq = boss.setAiMode(o.mode);
    if (o.ticks) {
      // Tied to the boss token (not the skill run) so a cancelled skill still
      // reverts — unless another AI change happened in the meantime.
      ctx.services.scheduler.after(o.ticks, () => {
        if (boss.aiSeq === seq) boss.setAiMode(previous);
      }, boss.token);
    }
  },
};

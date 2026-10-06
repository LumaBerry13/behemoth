// Runs a slash command as the caster (MythicMobs command with the caster as
// sender, e.g. "camerashake add @a[r=10] 0.4 1"). <placeholders> work; the
// target's name is available as <target.name>. No leading slash needed.
// o: { command }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "command",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.command === "string" && o.command.trim() ? [] : ["`command` is required"];
  },
  execute(ctx, _targets, o) {
    const cmd = String(o.command).replace(/^\//, "");
    if (!ctx.services.adapter.runCommand(ctx.caster, cmd)) ctx.services.log.debug(`command failed: ${cmd}`);
  },
};

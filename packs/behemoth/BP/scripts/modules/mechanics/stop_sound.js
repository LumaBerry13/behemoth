// Stops a sound for player targets (MythicMobs `stopsound`), e.g. a looping boss sound when it
// dies. The Script API has no stop-sound call, so it runs the vanilla /stopsound command as each
// player. Without `sound` every sound stops.
// o: { sound? }
const SOUND_ID = /^[A-Za-z0-9_.:-]+$/;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "stopSound",
  defaultTargeter: "@PlayersInRadius{r=40}",
  validate(o) {
    if (o.sound !== undefined && (typeof o.sound !== "string" || !SOUND_ID.test(o.sound))) return ["`sound` must be a sound id (letters, digits, _ . : -)"];
    return [];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const cmd = o.sound ? `stopsound @s ${o.sound}` : "stopsound @s";
    for (const t of targets) if (a.isPlayer(t)) a.runCommand(t, cmd);
  },
};

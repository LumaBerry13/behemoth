// Changes the caster's threat table for each player target (MythicMobs
// threat / taunt / clearThreat). mode: add (default), set, taunt (the target
// gets more threat than anyone else), clear (removes the target; with no
// targets, clears the whole table).
// o: { mode?="add", amount?=10 }
const MODES = ["add", "set", "taunt", "clear"];

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "threat",
  defaultTargeter: "@trigger",
  validate(o) {
    const errors = [];
    if (o.mode !== undefined && !MODES.includes(String(o.mode).toLowerCase())) errors.push(`\`mode\` must be one of ${MODES.join(", ")}`);
    if (o.amount !== undefined && typeof o.amount !== "number") errors.push("`amount` must be a number");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const table = ctx.boss.threat;
    const mode = String(o.mode ?? "add").toLowerCase();
    const amount = o.amount ?? 10;
    const players = targets.filter((t) => a.isEntity(t) && a.isPlayer(t));
    if (mode === "clear" && players.length === 0) return table.clear();
    for (const p of players) {
      if (!a.isEntity(p)) continue;
      if (mode === "clear") table.drop(p.id);
      else if (mode === "set") table.threat.set(p.id, amount);
      else if (mode === "taunt") table.threat.set(p.id, Math.max(0, ...table.threat.values()) + Math.max(1, amount));
      else table.add(p, amount);
    }
    ctx.boss.targetCacheTick = -1; // re-pick the target now
  },
};

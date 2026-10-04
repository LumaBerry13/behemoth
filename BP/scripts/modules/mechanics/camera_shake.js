// Shakes the camera of player targets (/camerashake). Not a MythicMobs mechanic
// on Java; used for Bedrock-side impact feedback.
// o: { intensity?=0.4 (0–4), seconds?=0.3, type?="positional" | "rotational" }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "cameraShake",
  defaultTargeter: "@PlayersInRadius{r=8}",
  validate(o) {
    const errors = [];
    if (o.intensity !== undefined && (typeof o.intensity !== "number" || o.intensity < 0 || o.intensity > 4)) errors.push("`intensity` must be 0–4");
    if (o.seconds !== undefined && (typeof o.seconds !== "number" || o.seconds <= 0)) errors.push("`seconds` must be > 0");
    if (o.type !== undefined && o.type !== "positional" && o.type !== "rotational") errors.push("`type` must be positional or rotational");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isPlayer(t)) a.cameraShake(t, o.intensity ?? 0.4, o.seconds ?? 0.3, o.type ?? "positional");
  },
};

// Changes the projectile running this skill (MythicMobs modifyprojectile),
// from a projectile's onTick / onHit skills.
//   trait: velocity (speed, blocks/tick) | inertia | gravity | radius | range
//   action: set (default) | add | multiply
// o: { trait, action?, value }
const TRAITS = { velocity: "speed", speed: "speed", inertia: "inertia", gravity: "gravity", radius: "radius", range: "range" };

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "modifyProjectile",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    if (!(String(o.trait).toLowerCase() in TRAITS)) errors.push(`\`trait\` must be one of ${Object.keys(TRAITS).join(", ")}`);
    if (o.action !== undefined && !["set", "add", "multiply"].includes(String(o.action).toLowerCase())) errors.push("`action` must be set, add or multiply");
    if (typeof o.value !== "number") errors.push("`value` must be a number");
    return errors;
  },
  execute(ctx, _targets, o) {
    const p = ctx.projectile;
    if (!p || p.ended) return;
    const key = TRAITS[/** @type {keyof typeof TRAITS} */ (String(o.trait).toLowerCase())];
    const action = String(o.action ?? "set").toLowerCase();
    const cur = p[key];
    const next = action === "add" ? cur + o.value : action === "multiply" ? cur * o.value : o.value;
    if (key === "speed") p.setSpeed(next);
    else p[key] = next;
  },
};

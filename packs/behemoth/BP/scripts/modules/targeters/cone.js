// @Cone{angle=60;r=6;rotation=0} — living entities in front of the caster within `r`
// blocks and `angle` degrees total width (yaw only). `rotation` turns the cone like
// fieldOfView: centre = caster yaw minus rotation (90 = the caster's left) [VERIFY
// against MythicMobs @LivingInCone rot]. Excludes summons, other bosses and
// creative/spectator players.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "Cone",
  validate(o) {
    const errors = [];
    if (o.r !== undefined && (typeof o.r !== "number" || o.r <= 0)) errors.push("`r` must be > 0");
    if (o.angle !== undefined && (typeof o.angle !== "number" || o.angle <= 0 || o.angle > 360)) errors.push("`angle` must be 0–360");
    if (o.rotation !== undefined && typeof o.rotation !== "number") errors.push("`rotation` must be a number (degrees)");
    return errors;
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const boss = ctx.boss;
    const loc = boss.location;
    const r = o.r ?? 6;
    const half = ((o.angle ?? 60) / 2) * (Math.PI / 180);
    const yaw = ((a.getYaw(boss.entity) - (o.rotation ?? 0)) * Math.PI) / 180;
    const fx = -Math.sin(yaw);
    const fz = Math.cos(yaw);
    return a.getEntities(boss.dimension, { location: loc, maxDistance: r, excludeTags: ["bhm_summon"] }).filter((e) => {
      if (e.id === boss.id || !a.hasHealth(e) || ctx.services.bosses.get(e.id)) return false;
      if (a.isPlayer(e) && !a.isTargetablePlayer(e)) return false;
      const dx = e.location.x - loc.x;
      const dz = e.location.z - loc.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return true;
      return Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / len))) <= half;
    });
  },
};

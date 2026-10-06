// fieldOfView{angle=90;rotation=0} — the target is inside a horizontal view cone
// of the caster (MythicMobs fieldofview{angle;r}). The cone is centred on the
// caster's yaw minus `rotation` degrees: rotation 90 = the caster's left side,
// 270 (or -90) = its right, 180 = behind. [VERIFY] sign convention against
// MythicMobs in-game (Archivist turning skills).
// Used as a skill target condition (targetIf); on the caster itself it checks
// the caster's current target.

/** @param {number} d */
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** @type {import("../../types/config").Condition} */
export default {
  name: "fieldOfView",
  validate(args) {
    const angle = args.angle ?? 90;
    const rot = args.rotation ?? args.r ?? 0;
    if (typeof angle !== "number" || angle <= 0 || angle > 360) return ["`angle` must be 0–360 degrees"];
    return typeof rot === "number" ? [] : ["`rotation` must be a number (degrees)"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    const t = target === ctx.caster ? ctx.boss.getTarget() : target;
    if (!t) return false;
    const from = ctx.boss.location;
    const to = a.locOf(t);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return true;
    const yawTo = (Math.atan2(-dx, dz) * 180) / Math.PI;
    const center = a.getYaw(ctx.caster) - Number(args.rotation ?? args.r ?? 0);
    return Math.abs(wrap(yawTo - center)) <= Number(args.angle ?? 90) / 2;
  },
};

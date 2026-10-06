// Tints entity targets (MythicMobs/ModelEngine tint) by writing the colour to
// an int entity property (default "bhm:tint", 0xRRGGBB; #FFFFFF = no tint).
// The entity's render controller has to read it (design doc §5, RP stub).
// Entities without the property are skipped.
// o: { color="#RRGGBB", property?="bhm:tint" }

const HEX = /^#?([0-9a-fA-F]{6})$/;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "tint",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.color === "string" && HEX.test(o.color) ? [] : ["`color` must be #RRGGBB"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const m = HEX.exec(String(o.color));
    if (!m) return;
    const value = parseInt(m[1], 16);
    const prop = o.property ?? "bhm:tint";
    for (const t of targets) {
      if (!a.isEntity(t)) continue;
      if (!a.setProperty(t, prop, value)) ctx.services.log.debug(`tint: ${t.typeId} has no int property ${prop}`);
    }
  },
};

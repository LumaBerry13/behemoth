// Sets an entity property on the boss (client visuals: textures, part
// visibility, animation speed — design doc §5). The property must be defined in
// the entity JSON.
// o: { property, value }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setProperty",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    if (typeof o.property !== "string" || !o.property.includes(":")) errors.push("`property` must be a namespaced property id");
    if (!["number", "boolean", "string"].includes(typeof o.value)) errors.push("`value` must be a number, boolean or string");
    return errors;
  },
  execute(ctx, _targets, o) {
    if (!ctx.services.adapter.setProperty(ctx.caster, o.property, o.value)) {
      ctx.services.log.warn(`setProperty: ${o.property} is not defined on ${ctx.caster.typeId}`);
    }
  },
};

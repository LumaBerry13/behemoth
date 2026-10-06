// "chance 0.3" or "chance{p=0.3}" — random roll.
/** @type {import("../../types/config").Condition} */
export default {
  name: "chance",
  validate(args) {
    const p = args.p ?? args.value;
    return typeof p === "number" && p >= 0 && p <= 1 ? [] : ["use the form `chance 0.3` (0–1)"];
  },
  test(ctx, _target, args) {
    return ctx.services.random.chance(Number(args.p ?? args.value));
  },
};

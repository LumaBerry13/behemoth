// ~onKillPlayer — the boss killed a player (MythicMobs onPlayerKill). @trigger = that player.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onKillPlayer",
  subscribe(bus, fire) {
    bus.on("killPlayer", fire);
  },
};

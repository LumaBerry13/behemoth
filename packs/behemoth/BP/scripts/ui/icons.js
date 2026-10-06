// Menu icons. Each key has a custom texture path (add PNGs at
// RP/textures/behemoth/ui/<key>.png, then pick "Custom" in Settings → Icon set)
// and a vanilla fallback (paths verified against the 1.26 vanilla texture index).
// Paths are used instead of item type ids: Chest-UI's numeric item ids shift
// between game versions, texture paths don't.

/** @type {Record<string, string>} key → vanilla texture path */
const VANILLA = {
  border_gray: "textures/blocks/glass_gray",
  border_black: "textures/blocks/glass_black",
  overlay: "textures/items/map_filled",
  log_level: "textures/items/book_writable",
  bone_markers: "textures/items/bone",
  hitboxes: "textures/items/iron_sword",
  seed: "textures/items/ender_eye",
  icon_set: "textures/items/name_tag",
  performance: "textures/items/clock_item",
  bosses: "textures/items/egg_null",
  boss: "textures/items/egg_null",
  nearest_boss: "textures/items/compass_item",
  teleport: "textures/items/ender_pearl",
  boss_info: "textures/items/nether_star",
  reset: "textures/items/totem",
  despawn: "textures/items/gunpowder",
  phase_prev: "textures/items/repeater",
  phase_next: "textures/items/repeater",
  skills: "textures/items/book_enchanted",
  skill: "textures/items/blaze_powder",
  packs: "textures/blocks/chest_front",
  pack: "textures/blocks/chest_front",
  pack_error: "textures/blocks/barrier",
  clear_cache: "textures/items/bucket_empty",
  diagnostics: "textures/items/comparator",
  probe: "textures/items/redstone_dust",
  about: "textures/items/book_normal",
  back: "textures/items/arrow",
  next_page: "textures/items/arrow",
  close: "textures/blocks/barrier",
  empty: "textures/blocks/structure_void",
};

/** Every icon key, for the docs / icon checklist. */
export const ICON_KEYS = Object.keys(VANILLA);

/**
 * @param {string} key @param {"vanilla" | "custom"} set
 * @returns {string} texture path for Chest-UI
 */
export function icon(key, set) {
  if (set === "custom") return `textures/behemoth/ui/${key}`;
  return VANILLA[key] ?? VANILLA.empty;
}

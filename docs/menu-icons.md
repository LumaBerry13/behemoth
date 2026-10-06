# `/behemoth` menu icons

The menu runs on vanilla textures out of the box. To use your own icons:

1. Add PNGs to the framework resource pack at `packs/behemoth/RP/textures/behemoth/ui/<name>.png`, using the names
   below. Square images, 16×16 or 32×32, look like inventory items.
2. Deploy, open `/behemoth`, and click **Icon set** to switch from *Vanilla* to *Custom*. The choice is saved in the
   world.

If a custom icon is missing, that slot shows Minecraft's missing-texture icon. Switch back to *Vanilla* at any time.

| File name (`<name>.png`) | Where it appears | Vanilla fallback |
|---|---|---|
| `border_gray` | Gray glass border tiles | `textures/blocks/glass_gray` |
| `border_black` | Black glass border tiles | `textures/blocks/glass_black` |
| `overlay` | Settings → Debug overlay | `textures/items/map_filled` |
| `log_level` | Settings → Log level | `textures/items/book_writable` |
| `bone_markers` | Settings → Bone markers | `textures/items/bone` |
| `hitboxes` | Settings → Hitbox preview | `textures/items/iron_sword` |
| `seed` | Settings → Seeded randomness | `textures/items/ender_eye` |
| `icon_set` | Settings → Icon set | `textures/items/name_tag` |
| `performance` | Settings → Performance | `textures/items/clock_item` |
| `bosses` | Main → Spawn a boss | `textures/items/egg_null` |
| `boss` | Each boss in the spawn list; unloaded bosses in the world list | `textures/items/egg_null` |
| `nearest_boss` | Main → Bosses in world | `textures/items/compass_item` |
| `boss_info` | Loaded bosses in the world list; boss → info card | `textures/items/nether_star` |
| `reset` | Boss → Reset | `textures/items/totem` |
| `despawn` | Boss → Despawn, Forget entry | `textures/items/gunpowder` |
| `phase_prev` | Boss → Previous phase | `textures/items/repeater` |
| `phase_next` | Boss → Next phase |
| `teleport` | Boss → Teleport to boss | `textures/items/ender_pearl` | `textures/items/repeater` |
| `skills` | Boss → Skills | `textures/items/book_enchanted` |
| `skill` | Each skill in the Skills list | `textures/items/blaze_powder` |
| `packs` | Main → Boss packs | `textures/blocks/chest_front` |
| `pack` | Each connected boss pack | `textures/blocks/chest_front` |
| `pack_error` | A boss pack that reported errors | `textures/blocks/barrier` |
| `clear_cache` | Diagnostics → Boss-pack cache (clear) | `textures/items/bucket_empty` |
| `diagnostics` | Main → Diagnostics, Diagnostics → Modules | `textures/items/comparator` |
| `probe` | Diagnostics → Script-event probe | `textures/items/redstone_dust` |
| `about` | Main → About | `textures/items/book_normal` |
| `back` | Back / Previous page | `textures/items/arrow` |
| `next_page` | Next page | `textures/items/arrow` |
| `close` | Close | `textures/blocks/barrier` |
| `empty` | "Nothing here" placeholders | `textures/blocks/structure_void` |

The list comes from `packs/behemoth/BP/scripts/ui/icons.js`. Add new keys there and here together.

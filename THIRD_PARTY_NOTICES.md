# Third-party notices

## Chest-UI

The `/behemoth` menu uses **Chest-UI**: https://github.com/Herobrine643928/Chest-UI
(commit `115d95c8239a0ee2f578a9a7710699a8f6627f26`).

- Original pack by LeGend077; maintained by Herobrine64 and LeGend077; pattern function by Aex66.
- Licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. The full license text is in
  `packs/behemoth/BP/scripts/adapter/vendor/chest_ui/LICENSE`.
- Files used:
  - BP: `scripts/adapter/vendor/chest_ui/{forms.js, forms.d.ts, constants.js, typeIds.js}`
  - RP: `ui/*.json`, `textures/ui/{d_b, d_g, item_background}.{png,json}`
- Changes:
  - `constants.js`: `inventory_enabled = false`.
  - `ui/_global_variables.json`: inventory section and furnace layout disabled; only the 54-slot layout is on.
  - The script files are moved under `scripts/adapter/vendor/chest_ui/`.

## Minecraft

Menu icons fall back to vanilla Minecraft texture paths. They are referenced by path only; no vanilla files are
included.

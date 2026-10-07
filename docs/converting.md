# Converting a MythicMobs boss

The converter turns a MythicMobs + ModelEngine boss into a finished Behemoth boss pack: a behavior
pack and a resource pack you drop into Minecraft, plus an `.mcaddon`. You prepare one folder; the
converter does the rest and writes a report of anything it could not do.

```
npm run convert -- private/Wendigo --check    # optional: does the framework support everything the YAML uses?
npm run convert -- private/Wendigo            # build the packs
npm run deploy                                # copy them into the game (or double-click the .mcaddon)
```

Requirements: Python 3.10+ (`pip install -r converter/requirements.txt`), Node.js for `npm run`, and the
Behemoth framework packs active in the world.

## 1. Prepare the model in Blockbench

Purchased packs often ship Java ModelEngine models (`.bbmodel`). Convert each one to a **Bedrock
entity** in Blockbench first (Minecraft Entity Wizard / "Bedrock Entity" project) and export:
the behavior file, the client entity file, the geometry, the animations and the texture.

- Keep the **bone names** from the ModelEngine model. Skills find bones by these names
  (`@modelpart{pid=right_hand}` → bone `right_hand`). ModelEngine prefixes are fine: `h_head`,
  `p_grab` and so on are found when the YAML says `head` or `grab`.
- Keep the **animation names**. MythicMobs plays them by their short name: `state{s=swing_1}` needs
  an animation `animation.<anything>.swing_1`.
- Special animation names: `idle`, `walk` (and `run`) loop on their own; `spawn` plays when the boss
  spawns and `death` when it dies, like ModelEngine does.
- The client entity only has to **list** the animations under `"animations"`. Do not add
  `scripts.animate` or animation controllers for skills; the converter wires everything.

## 2. The folder

```
private/Wendigo/
├── wendigo.yml                 MythicMobs files: mobs and skills, any names, any number
├── wendigo_skills.yml
├── WENDIGO/                    one folder per mob to convert, named EXACTLY like its MythicMobs id
│   ├── wendigo.behavior.json   behavior entity (a bare Blockbench export is fine)
│   ├── wendigo.entity.json     client entity, with its animations listed
│   ├── wendigo.geo.json        geometry
│   ├── wendigo.animation.json  animations (several files are fine)
│   ├── wendigo.png             texture (file name = the last part of the client entity's texture path)
│   └── bossbar.png             optional custom boss bar (section 6)
├── sounds/                     optional .ogg files (section 5)
├── pack_icon.png               optional
└── behemoth.json               optional settings (section 7); the converter adds the pack UUIDs here
```

The converter recognises the JSON files by what is inside them, so their names do not matter. It
never changes your files except `behemoth.json`.

What it writes:

```
private/Wendigo/pack/BP, pack/RP       the finished packs (rebuilt on every run)
private/Wendigo/dist/Wendigo-1.0.0.mcaddon
private/Wendigo/report.md              what was converted, approximated or skipped
```

`private/` is never committed (licensed content).

## 3. Mobs, bosses and minions (YAML with several entities)

- Put **every** MythicMobs file of the pack in the folder, even when you convert only some mobs:
  skills often live in a separate file, and mobs call each other's skills.
- Give a folder to **each mob you want converted**. Mobs without a folder are not converted.
- **Which one is the boss:** the mob no other converted mob summons; if several qualify, the one with
  the most `Health`. Set `"boss"` in `behemoth.json` to choose it yourself.
- Every other converted mob becomes a **minion**: driven by the framework, never listed in the
  `/behemoth` menu, removed when its boss dies or resets. MythicMobs `NoAI` mobs (armor-stand effects:
  telegraphs, slashes) become minions without AI; `Invincible: true` makes them invulnerable.
- `summon{t=MOB}` of a converted mob spawns its entity automatically. A summon of a MythicMobs mob
  that has **no folder** is skipped and listed under "Needs you" (e.g. a heart you chose not to
  convert). `summon{t=ZOMBIE}` and other vanilla mobs work as they are.
- **Two mobs with one model:** give each its own folder with the same files, and give the second one
  another entity id in `behemoth.json` (`"mobs": { "MOB_2": { "identifier": "pack:mob_2" } }`).
- Mobs from another pack's YAML (mixed packs) work the same way: only folders are converted.

## 4. What is done for you

- A **bare behavior file** gets health (`Health`), a collision box from the model size, walking and
  pathfinding, follow range, knockback resistance and immunities (`DamageModifiers` of 0), plus the
  Behemoth AI groups and properties. Anything already in the file is kept.
- With a `death` animation, a **scripted death**: the boss stays while the death animation and death
  skills play, then disappears.
- All animations are linked; looping animations started on spawn and never stopped (ModelEngine
  layers such as `passive`) always play; `spawn` and `death` play automatically.
- Animation keyframe scripts (`mm:SOME_SKILL;` in the timeline) that only play sounds become real
  animation sounds; others are removed and reported.
- Sounds, particles (coloured dust, block particles), model-part hiding, grabs, recoil, placeholders,
  variables and the rest of the MythicMobs vocabulary the framework supports.

## 5. Sounds

Put the `.ogg` files in `sounds/`. Name each file after the **last part** of the MythicMobs sound id:
`sound{s=littleroom_wendigo:littleroom.wendigo.growl}` → `growl.ogg`. Variants of one sound end in
`_1`, `_2`, … (`growl_1.ogg`, `growl_2.ogg`); one is picked at random each time.

Sounds the YAML does not use still get packaged as `<pack id>.<name>`.

## 6. Custom boss bar

Put `bossbar.png` in the boss's folder. It is drawn around the vanilla boss bar, and the boss's name
moves below the bar. Bosses without an image keep the normal vanilla bar.

- **Canvas: 256 × 64**, centred on the bar; draw it at **1024 × 256** (4×) or any size with the same
  4 : 1 shape. Start from [`bossbar_template.png`](bossbar_template.png).
- The vanilla bar (the part that shows health) sits at x 37–219, y 28–33 of the canvas (x 148–876,
  y 112–132 at 1024 × 256). Leave that area transparent so the health shows through; decorate around it
  (frames, skulls, horns above, ornaments at the ends).
- The name is drawn below the bar at y 36–45 (y 144–180 at 4×); keep that area light.
- Keep the boss's `Display` name plain (letters, digits, spaces): the image file is named after it.
  A skill that renames the bar (`barSet`) keeps the image only while the new name has its own image file.

## 7. behemoth.json (optional settings)

Created on the first run with the pack identity; everything else is optional.

```json
{
  "pack": { "name": "Wendigo", "id": "wendigo", "version": [1, 0, 0], "uuids": { "...": "written by the converter" } },
  "boss": "WENDIGO",
  "mobs": {
    "WENDIGO": {
      "identifier": "pack:other_id",
      "bone_aliases": { "stones_modelpart": "stones" },
      "blades": ["sword"],
      "always_animate": ["passive"],
      "tuning": { "stop_distance": 2.5 }
    }
  },
  "tuning": {
    "damage_multiplier": 2.0,
    "ignore_difficulty": true,
    "stop_distance": 2.5,
    "leash_range": 64,
    "reset_after_no_players": 600,
    "randomskill_mode": "available",
    "trigger_overrides": { "SOME_METASKILL": "onTimer:10" },
    "option_overrides": { "SOME_METASKILL": { "propel": { "height": 0 } } },
    "extra_lines": { "SOME_METASKILL": [ { "m": "cameraShake", "o": { "intensity": 0.3 } } ] }
  },
  "particles": { "some_java_particle": "minecraft:some_bedrock_particle" },
  "mob_types": { "MOB_WITHOUT_FOLDER": { "type": "minecraft:pig", "lifetime": 100 } },
  "bullets": { "11400": "pack:bullet_entity" }
}
```

- **Never change or delete `pack.uuids`**: worlds and the framework recognise the pack by them. Raise
  `pack.version` when you publish an update.
- `blades`: weapon bones whose hits follow the blade from hilt to tip.
- `bone_aliases`: a ModelEngine part name the YAML uses → the Bedrock bone that stands for it.
- `tuning` changes how the boss plays on Bedrock without touching the YAML. Every change is listed in
  the report.

## 8. Reading the report

`report.md` has three sections:

- **Needs you** — something is missing or not supported: a summoned mob without a folder, a part the
  model does not have, an unsupported mechanic. Fix the folder and run again, or accept the skip.
- **Approximated on Bedrock** — converted, but behaves a little differently than on Java (with the
  reason). Read once; test in game.
- **Info** — everything the converter did for you.

If `--check` or "Needs you" lists **unsupported mechanics**, that part of the boss needs a framework
addition; everything else still converts and works.

## 9. Testing

`npm run deploy` copies the framework and every converted pack into the game's development folders
(rejoin the world after resource changes). In game: `/behemoth` → Spawn a boss, or
`/summon <entity id>`. Before playing, `npm run sim -- <entity id> 400 --distance 12` runs a headless
fight and catches script errors.

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
├── WENDIGO/                    one folder per mob: named like its MythicMobs id or its ModelEngine model
│   ├── wendigo.behavior.json   behavior entity (a bare Blockbench export is fine)
│   ├── wendigo.entity.json     client entity, with its animations listed
│   ├── wendigo.geo.json        geometry
│   ├── wendigo.animation.json  animations (several files are fine)
│   ├── wendigo.png             texture(s) (file name = the last part of the client entity's texture path)
│   ├── *.render_controller.json optional: the entity's own render controller(s)
│   ├── bossbar.png             optional custom boss bar art, with the name (section 6)
│   └── sounds.json             optional: the Java pack's sounds.json (section 5)
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
- **Invisible effect mobs need no folder.** A summoned mob with `Options: Invisible: true` (or of type
  `ARMOR_STAND`/`MARKER`) and no folder, such as a damage puddle or a telegraph marker, gets a generated
  invisible entity (empty model) that runs its skills in place. It is listed under Info. If such a mob
  has a ModelEngine model of its own (a telegraph decal, a slash), give it a folder like any other mob
  to see the model; the report reminds you under "Needs you".
- **Effect entities** (NoAI or invisible minions: telegraphs, ground cracks, slashes) have their own
  summon limits (64 per boss, 192 in all), so a volley of them never blocks real minions.
- **Projectile models** (`projectile{bulletModel=11400}`): convert the model to a Bedrock entity
  (client entity, geometry, texture, animations optional; no behavior file needed), put it in a folder,
  and name the folder in `behemoth.json`: `"bullets": { "11400": "BOOK_MISSILE" }`. The converter makes
  it a flying model (no AI, no gravity, cannot be hurt; looping animations always play). Without it the
  projectile is drawn with particles.
- **Two mobs with one model:** give each its own folder with the same files, and give the second one
  another entity id in `behemoth.json` (`"mobs": { "MOB_2": { "identifier": "pack:mob_2" } }`).
- Mobs from another pack's YAML (mixed packs) work the same way: only folders are converted.

## 4. What is done for you

- A **bare behavior file** gets health (`Health`), a collision box from the model size (at most 2
  blocks wide: wider bosses can stop walking on Bedrock; `behemoth.json` `collision_box` changes it), walking and
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

### Folder names, textures and render controllers

- A mob folder is named after the MythicMobs mob id (`the_archivist_AOE`) **or** after the ModelEngine
  model the mob uses (`model{m=thearchivist_groundexplosion}` → `THE_ARCHIVIST_GROUND_EXPLOSION`).
  Upper/lower case and `_` do not matter.
- **Animated textures** (one image per frame): give the client entity textures named `<name>1`,
  `<name>2`, … and no `default`. The converter adds a render controller that cycles them, 10 frames per
  second (`behemoth.json` `mobs.<MOB>.texture_fps` changes it).
- **Your own render controller:** put its `.render_controller.json` in the mob folder. It is copied
  into the pack, and the converter extends it with what the framework needs (colour tint, hiding
  model parts), so tints and part hiding work with custom controllers too.
- MythicMobs `Marker: true` armor stands and non-collidable effect minions cannot be hit (a tiny
  `custom_hit_test`) but keep a collision box (0.5 by default, `collision_box` changes it), so they
  rest on the ground. Bosses always keep a normal hitbox.

## 5. Sounds

Put the `.ogg` files in `sounds/`. Name each file after the **last part** of the MythicMobs sound id:
`sound{s=littleroom_wendigo:littleroom.wendigo.growl}` → `growl.ogg`. Variants of one sound end in
`_1`, `_2`, … (`growl_1.ogg`, `growl_2.ogg`) or just a number (`growl1.ogg`); one is picked at
random each time. Sound ids without a dot (`littleroom_thearchivist:hurt`) become
`littleroom_thearchivist.hurt` in the pack, so two boss packs never share a sound name.

Sounds the YAML does not use still get packaged as `<pack id>.<name>`.

If you have the original Java pack's `sounds.json` (from `assets/<namespace>/sounds.json`), put it in
the mob's folder (`MY_BOSS/sounds.json`). It says which file belongs to which sound id, so the `.ogg`
files can keep their original names (`sr.air_jump` → `air_attack_jump.ogg`).

- If the report says a sound "was not found in sounds/", the file name does not match the end of the
  sound id (for example `sr.air_jump` needs `air_jump.ogg`). Rename the file and convert again.
- Java vanilla sounds (`entity.ender_dragon.flap`) are translated to their Bedrock names for the common
  ones. If the report lists one as a Java sound name, add its Bedrock event to `behemoth.json` under
  `"sounds": { "entity.some.sound": "mob.some.sound" }`.

## 6. Custom boss bar

Put `bossbar.png` in the boss's folder: your bar art **including the boss name**. It is drawn around
the vanilla boss bar (the health part stays the game's own bar). The game's name text is hidden for
this boss, so the name you draw is the only one shown.

- The simplest start is [`bossbar_template.png`](bossbar_template.png) (1024 × 256). The health bar sits at
  x 148–876, y 112–132 of it. Leave that area transparent so the health shows through, and decorate
  around it (frame, name, skulls, horns).
- Any other size works too, for example a tight frame around the bar. Size and position are set in the
  finishing touch below.
- Without `bossbar.png` the boss gets the plain vanilla bar with its `Display` name.
- How it works: the bar's name becomes a key (`bhmbar_<entity id>`), the framework's HUD hides text
  starting with `bhmbar_`, and it draws `textures/behemoth/bossbars/bhmbar_<entity id>.png`. Because
  the image carries the name, skills that rename the bar (`barSet`) have no effect on this boss.
- Bosses from other add-ons show a small missing-texture square on their bar unless some resource pack
  has an empty `textures/behemoth/bossbars/<their bar name>.png`. The framework ships these for the
  vanilla Wither and Ender Dragon.

### Finishing touch: size and position

After the pack is built and you have seen it in game, adjust the art in `behemoth.json`, run the
converter again and deploy:

```json
"mobs": { "WENDIGO": { "bossbar_layout": { "width": 196, "height": 39, "x": 0, "y": -1.5 } } }
```

`behemoth.json` already shows the current values (filled in from your image), so you only change
numbers.

- Units are GUI pixels. The vanilla bar is **182 wide and 5 tall**, so a frame drawn 1 pixel per GUI
  pixel around it is `"width"` = the image's own width in pixels.
- `width`, `height`: the size of the art. To keep the image's shape, change both by the same factor,
  or delete `height` (it is then worked out from `width` and written back). Different proportions
  stretch the image; the report says so. `"scale"` still works too: 1 = 256 wide (the template).
- `x`, `y`: move the art (+x right, +y down). At 0, 0 the art is centred on the template's area, whose
  centre is 1.5 below the bar's centre. A frame centred on the bar therefore needs `"y": -1.5`.
- The art can be up to 512 × 128 around the bar. If it goes past that edge, the report says so under
  "Needs you".
- It follows the screen size and GUI scale like the vanilla bar.
- To check: `npm run convert -- private/<Boss>`, `npm run deploy`, rejoin the world, then
  `/behemoth` → Spawn a boss.

## 7. behemoth.json (optional settings)

The first run creates it, and every run fills in **all** editable entries, empty when unused: `""`,
`null`, `{}` and `[]` mean "not set". Fill in what you need and run the converter again; your values
are never changed. Entries in the wrong place (for example `items` inside `pack`) or misspelled stop
the conversion with a message instead of being ignored. An example with values:

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
      "bossbar_layout": { "width": 196, "height": 39, "x": 0, "y": -1.5 },
      "collision_box": { "width": 2.0, "height": 4.5 },
      "tuning": { "stop_distance": 2.5 }
    }
  },
  "tuning": {
    "health_multiplier": 2,
    "max_hit_percent": 10,
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
  "items": { "Steel_Raider_Shield": "minecraft:shield" },
  "sounds": { "entity.some.java_sound": "mob.some.bedrock_sound" },
  "mob_types": { "MOB_WITHOUT_FOLDER": { "type": "minecraft:pig", "lifetime": 100 } },
  "bullets": { "11400": "pack:bullet_entity" }
}
```

- **Never change or delete `pack.uuids`**: worlds and the framework recognise the pack by them. Raise
  `pack.version` when you publish an update.
- `blades`: weapon bones whose hits follow the blade from hilt to tip.
- `collision_box`: the mob's hitbox in blocks (shown with the current value). Bedrock mobs wider than
  about 2 blocks may play their walk animation without moving.
- `bone_aliases`: a ModelEngine part name the YAML uses → the Bedrock bone that stands for it.
- `items`: MythicMobs custom items (`dropitem{i=...}` and the mob's `Drops`) → a Bedrock item id. Vanilla names (`DIAMOND`) work
  without it.
- `health_multiplier` raises the boss's health above the YAML's `Health`; `max_hit_percent` is the most
  of its max health one hit can take (default 10, so even a mace smash needs 10+ hits; 0 = no cap).
  Minions are not capped. `/kill` and the void always go through.
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

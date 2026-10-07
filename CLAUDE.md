# CLAUDE.md — Behemoth

Persistent context for Claude Code sessions. The **single source of truth** is
[`Behemoth — Design & Project Documentation.md`](Behemoth%20—%20Design%20&%20Project%20Documentation.md)
(referred to below as "the design doc"). This file is a condensed working guide; when they disagree, the design doc wins — and fix this file.

## What this project is

**Behemoth** (renamed from its working title on 2026-10-06) is a boss framework for Minecraft Bedrock on the Script API. It is shipped as a **separate library pack** (decision D1): users install the framework once; each **boss pack** contains only its boss config(s), entity/model/animations and the standard **connector**, and registers its bosses with the framework over script events. Plus an offline **Python converter** (`bhmconv`) that turns MythicMobs + ModelEngine bosses (YAML + Bedrock model/animations) into standalone Behemoth boss packs.

**Status (2026-10-08):** M1 + M2 done (Dark Knight converted and tested in-game, incl. reload). Wendigo (Little Room) tested in-game by the owner (all skills, animations, consume, particles OK); it is now built in folder mode from `private/WendigoFolder` (raw Blockbench files; the old job output `private/Wendigo/pack` was removed to avoid a duplicate pack). Converter folder mode + docs/converting.md + custom boss bars are in; next: the owner converts bosses alone, then a debug session, then v1. Its YAML removes the boss after 20 s total without line of sight to a target (`WENDIGO_wussvanish`) — intended by the original. M4 in progress: reset/leash, profiler, all §13 v1 modules, the library split + cache-first registration protocol, the `/behemoth` chest-UI menu, and the Archivist feature pass (variables/placeholders, entity projectiles, effect entities, rotation/ray-trace/stun/tint/bossBar, D6/D7) are in. The converter does NOT map the Archivist-pass modules yet — that happens with the Archivist conversion. Next: in-game test of the library split + menu, the shared particle library, then the next real boss (`private/TheArchivist/` is a raw Java ModelEngine/MythicMobs pack — needs a Bedrock model first, or converter support for Java ModelEngine models; ask the owner). The Dark Knight's stones entity is intentionally NOT converted (summons a `minecraft:pig`, job `mob_types`).

## Dev commands

- `npm test` — check + validate + converter tests + scenarios for both bosses. Run before every commit.
- `npm run check` — `tsc --checkJs` over `packs/*/BP/scripts` against the pinned typings (`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0). Catches invented/misspelled API names. Vendored Chest-UI JS is excluded (its `forms.d.ts` is used).
- `npm run validate` — the real Validator over every boss pack's `scripts/bosses/index.js` (packs/* and private/*/pack), after the same JSON round-trip + track decoding the framework does. `--config <file>` validates one config module.
- `npm run sim:scenarios -- [typeId]` — headless regression: combat rules (friendly fire, custom death backstop, reload mid-death, reset, leash, script invulnerability), every `demo_*` module skill (demo boss), the **registration protocol** (cache restore after reload with nothing re-sent, changed payload re-requested, player `/scriptevent` ignored, protocol/version refusal, type takeover refused, corrupt payload re-requested, stalled transfer expiry) and the **menu** (54-slot form, glass border, toggle persists).
- `npm run sim:hits -- <typeId> <skill,skill>` — hit map of attacks around the boss with the real baked tracks + vanilla-melee cancel + walk speed.
- `npm run sim -- <typeId> [ticks] [--hit N] [--distance D] [--walk] [--chase] [--debug] [--death-event E]` — headless fight.
- The simulator (`tools/sim/boot.mjs`) loads the framework AND every boss pack's `main.js`; they talk over a stubbed `sendScriptEvent` (next-tick delivery, `BHM_SIM_MSG_LIMIT` chars max, default 2048 — so chunking is exercised). `@minecraft/server-ui` is stubbed (`ui_stub.mjs`: records forms, `clicks` queue).
- `npm run convert -- private/<Boss>` — **folder mode** (docs/converting.md): MythicMobs YAML + one sub-folder per mob named after its MM id (files recognised by content) + optional `sounds/`, `pack_icon.png`, `bossbar.png`, `behemoth.json` (settings + pack UUIDs written once) → `pack/{BP,RP}`, `dist/<Pack>.mcaddon`, `report.md` (Needs you / Approximated / Info). `--check` lists unsupported mechanics only. Code: `converter/bhmconv/folder.py` builds the job; `cli.py` auto steps (`spec.auto`): `complete_behavior`, `add_scripted_death`, `_detect_always`, `_auto_skills` (spawn/death anims, flat fast-timer propel), automatic sound event names.
- `npm run convert -- --job private/<Boss>/<boss>.job.json` — job mode (legacy): builds `private/<Boss>/pack/{BP,RP}` (standalone boss pack) + `private/<Boss>/<boss>.report.md`. `npm run test:converter` — pytest incl. the kitchen-sink end-to-end test (`converter/tests/fixtures/kitchen/`; extend its YAML when adding a mapping).
- `npm run deploy` — framework → `Behemoth_BP/RP`, each boss pack → `<PackName>_BP/RP` in the game's development folders (`BHM_COM_MOJANG` to override); removes legacy `MythicBedrock_*` folders.
- `npm run package` — `.mcaddon` files: `dist/` (framework + public packs), `private/<Boss>/dist/` (licensed).
- Typings: `node_modules/@minecraft/server/index.d.ts` and `.../server-ui/index.d.ts` — grep them instead of guessing.

## Decisions in use (design doc §15)

- **D1 [DECIDED 2026-10-06]:** framework is a separate library pack; boss packs register over script events (cache-first protocol, below).
- **D2:** `@minecraft/server` **2.10.0**, `@minecraft/server-ui` **2.2.0**, `min_engine_version` [1, 26, 50] — owner's game is 1.26.52 (verified from the install).
- **D3–D7, D9 [DECIDED 2026-10-06]:** D3 execution rules = design doc §7 defaults; D4 converted purchased bosses stay in `private/`; D5 bake only bones the YAML references (+ `bone_aliases`, `blades`); D6 bosses/minions removed on Peaceful (`allowPeaceful` opts out); D7 `stats.healthScaling` + loot chest where the boss died, protected from explosions (`loot.mode: "ground"` opts out); D9 plain JS + JSDoc + `types/config.d.ts`.
- **D8 deferred:** owner's machine is too fast to measure a CPU budget; revisit later.
- **D10 [DECIDED 2026-10-06]:** no licence, all rights reserved (owner may open it later) — don't add a LICENSE file.
- Java ModelEngine models are converted to Bedrock **by hand** (owner, Blockbench); the converter reads `.bbmodel` only for timeline markers (M3 remainder).
- New open questions: don't silently pick an answer — ask, then record [DECIDED].

## Before writing any code

1. Check the current milestone (design doc §14) and the open decisions (§15).
2. Re-read §3 (platform limits) and §13 (v1 scope) for the area you're touching.
3. Do not build features from a later milestone than the current one without asking.

## Hard rules (design doc §17)

- **Never invent Script API names.** Anything not confirmed in the pinned typings gets a `// [VERIFY]` comment and is called out in the reply.
- **Stable APIs only.** No beta/experimental modules.
- **Only the adapter layer (`scripts/adapter/`, incl. `adapter/Ui.js` and `adapter/vendor/`) imports `@minecraft/*`** in the framework. (Boss-pack connectors import `@minecraft/server` themselves — they are separate packs.)
- **Mechanics and conditions are stateless** singletons; state lives in `BossInstance` or the execution `ctx`.
- **Every scheduled task carries the boss instance's cancel token.** One central scheduler loop — no per-skill `runInterval`, no nested `runTimeout` chains. Heavy work → `system.runJob`.
- Check `entity.isValid` before every step that touches an entity. Defer world writes inside before-events with `system.run`.
- **All time values are ticks.** Name ambiguous fields `...Ticks`.
- No dynamic imports. Framework modules = static import + bind line in `registry/SkillManager.js`. Boss packs list configs in `scripts/bosses/index.js` (`export default [ ... ]`).
- Boss configs are **plain JSON data** (they cross packs): no functions. `schemaVersion` required.
- Deliver complete, runnable files — no partial snippets, no leftover debug output.
- New platform limit → row in design doc §3. Decision → [DECIDED] in the matching section, as-of date updated.
- Framework `main.js` VERSION = `connector/framework.json` `runtime_version` (test-enforced); converted packs and the demo pack use it as `minFramework`. Bump both when boss packs need new framework features.
- **Never change the framework's manifest UUIDs** (`packs/behemoth/*/manifest.json`, mirrored in `connector/framework.json`): every boss pack depends on them. Bump versions instead; bump the protocol (`PROTOCOL` in Registrar + connector) only for breaking wire changes.
- `connector/connector.js` is canonical; the demo pack and converter output must carry an identical copy (tested).

## Architecture (design doc §4)

Five layers inside the framework, each talks only to the one below:

1. Configs + generated data (live in **boss packs**, received by the Registrar)
2. Modules (`modules/mechanics|targeters|conditions|triggers/`, one file each; `modules/shared/` helpers)
3. Registries/managers (`SkillManager` bind lists; `BossManager.register(compiled)` binds a boss type at runtime and takes over loaded entities of that type)
4. Core runtime (`BossInstance`, `Scheduler`, `EventBus`, `ThreatTable`, `Persistence`, `Validator`, `SkillExecutor`, `Registrar`, `Settings`, `TrackCodec`)
5. Adapter (sole caller of `@minecraft/server` / `-ui`)

Module contracts (typed in `types/config.d.ts`):

| Kind | Shape |
| --- | --- |
| Mechanic | `{ name, requires?, defaultTargeter?, validate(options, vctx) → errors[], execute(ctx, targets, options) → void \| delayTicks }` |
| Targeter | `{ name, validate(options), resolve(ctx, options) → (Entity \| Location)[] }` |
| Condition | `{ name, validate(args), test(ctx, target, args) → boolean }` (executor handles negation) |
| Trigger | `{ name, subscribe(bus, fire), match?(arg, event), validateArg?(arg) }` |

### Boss-pack protocol v1 (core/Registrar.js ⇄ connector/connector.js)

- framework → packs: `bhm:ready {p, fw}`, `bhm:need {p, pack, hash}`, `bhm:ack {p, pack, hash, ok, bosses, errors}`.
- pack → framework: `bhm:hello {p, pack, ver, hash, size, min}`, `bhm:part "<pack>|<hash>|<i>|<n>|<data>"` (raw).
- **Cache-first:** accepted payloads are stored in world dynamic properties (`bhm:cache` index + `bhm:cache:<pack>:<i>` parts ≤ 30000 chars). In its first tick after a load/reload the framework restores every cached pack, then sends `bhm:ready`; packs say hello; matching hash → ack only (nothing re-sent). New/changed hash → one `bhm:need` (deduped) → parts (connector starts at 65536 chars and halves on refusal) → FNV-1a checksum → JSON → track decode → validate → bind → cache → ack.
- Guards: script-sent events only (events with a source entity/block are ignored), protocol + `minFramework` checks, a type owned by one pack can't be taken by another, transfers time out after 200 ticks, packs not seen for 1200 ticks lose their cache entry (bosses stay loaded until reload), duplicates ignored.
- Payload size: Dark Knight 26 KB (compact tracks), demo 5 KB. Measured in-game (2026-10-06, 1.26.52): script-event messages ≥ 262144 chars accepted, delivered 1 tick later; cache restore after `/reload` 1 ms. Connector starts at 65536-char parts (halves on refusal). The sim keeps a 2048-char limit on purpose so chunking stays tested.

### Menu (`/behemoth`)

- One custom command `bhm:behemoth` (operators, works without cheats) opens `ui/Menu.js` (chest UI via vendored Chest-UI, `adapter/Ui.js`, retries while the player is busy).
- 54 slots, checkerboard border of gray/black glass (texture paths, never item ids), content in the 7×4 interior, controls on the bottom row (45 back, 48 prev, 49 close, 50 next).
- Pages: Main (settings: overlay, log level, bone markers, hitbox preview, seeded RNG, icon set, performance), Spawn a boss (kind boss only), Bosses in world (nearest first, incl. unloaded ones from `bhm:known`; detail: info, reset, despawn, phase ±, teleport, skills → cast), Boss packs, Diagnostics (script-event probe, clear cache, modules), About (credits).
- Config `kind`: `"boss"` (default) or `"minion"`. Minions run like bosses but never appear in the menu's boss lists or `nearest()`. `summon{bind}` (default true) binds summons to their boss (`boundSummons`, persisted); they are removed when the boss dies, despawns or resets.
- Removed packs: `install()` skips configs whose entity type no longer exists (`EntityTypes.get`); a cached pack with none left loses its cache entry; cached packs that never say hello within 100 ticks of `bhm:ready` are unloaded and their cache deleted (`forgetSilentPacks`).
- Known bosses: world property `bhm:known` (id → type, name, dim, xyz) so the menu lists unloaded bosses too; pruned when the type is gone.
- Settings persist in world property `bhm:settings` (`core/Settings.js`), applied on load (log level, RNG seed). Icons: `ui/icons.js` (vanilla fallbacks verified against the 1.26 texture index; custom set = `RP/textures/behemoth/ui/<key>.png`, list in `docs/menu-icons.md`).
- Chest-UI is CC BY 4.0: keep `THIRD_PARTY_NOTICES.md` and the vendored LICENSE/README.

## Layout

```
packs/behemoth/BP        framework: manifest, scripts/{main.js, adapter/{Adapter,Ui}.js + vendor/chest_ui, core/, registry/, modules/, ui/, debug/, types/}
packs/behemoth/RP        framework resources: ui/ (Chest-UI), textures/ui/, particles/ (bhm:* library, generated by tools/particles.py) + textures/behemoth/particles/
packs/behemoth_demo/     public demo boss pack (bhm_demo:test_boss, vanilla zombie model, demo_* skill per module)
connector/               connector.js (canonical) + framework.json (UUIDs/versions boss packs depend on)
converter/               bhmconv: convert.py, bhmconv/{keyframes,bake,mythic,entity,jsout,cli}.py, tests/ (+ fixtures/kitchen)
tools/                   packs.mjs, deploy.mjs, validate.mjs, package.py, sim/{boot,loader,mc_stub,ui_stub,run,hits,scenarios}
docs/                    menu-icons.md
private/<Boss>/          (git-ignored) licensed sources + <boss>.job.json; pack/ = generated boss pack; dist/ = .mcaddon
```

Execution semantics:
- Skill = trigger → skill `if`/`chance`/cooldown → steps in order. A mechanic returning N > 0 pauses the run N ticks.
- A line with `delay: N` fires N ticks later WITHOUT pausing the sequence.
- Lines without `t` use targets inherited from the calling skill (`skill`/`randomSkill`/`aura`/`hitbox`/`projectile`), else the mechanic's default targeter. An explicit targeter that finds nothing skips the line.
- `skill`/`randomSkill` respect the called skill's cooldown and conditions; phase `onEnter`, `aura` ticks, `hitbox`/`projectile` hits and menu skill casts force.
- `exclusive` skills take the cast lock and respect `config.gcd`; `gcd` mechanic + `offGcd` condition give MythicMobs-style GCD.
- Death cancels everything, then `onDeath` skills run for up to 100 ticks.
- Line keys `repeat` + `repeatInterval` (non-blocking) and `cooldown` (per line, MythicMobs `cd=`); skill key `targetIf` (TargetConditions: filters the inherited targets, none left = no run); any condition may end in ` castInstead <skill>` / ` orElseCast <skill>`.
- Variables (`core/Variables.js`, `services.vars`): scopes `caster.` (default, persisted) / `target.` / `trigger.` / `skill.` (per run, passed to called skills) / `global.` (world property `bhm:vars`); `type`, `duration`; config `variables` = initial values. `<placeholders>` in option strings are resolved per execution by the executor (`step.dynamic`); validation substitutes 1. Pure helpers (`TOKEN`, `hasPlaceholder`, `coerce`, `sampleValue`) live in `SkillParser.js` so `npm run validate` stays game-free.
- Skills started from a projectile / ray trace get `ctx.origin` (`@Origin`) and `ctx.projectile` (`modifyProjectile`). Mechanics that take a targeter as an option validate it with `vctx.checkTargeter` and resolve it with `executor.resolveTargeter`.

Particle library (`docs/particles.md`): `bhm:dust`, `bhm:dust_transition`, `bhm:spark`, `bhm:smoke`, `bhm:glow`, `bhm:flash`, `bhm:ring`, `bhm:telegraph`, `bhm:swirl` live in the framework RP (never a separate pack). Edit `tools/particles.py`, run it, commit the output (pytest checks it is current). Particle files are `bhm_<name>.particle.json` (Snowstorm-friendly); every variable is defaulted with `??` in the emitter creation expression and colours are floats `variable.color_r/_g/_b/_a` (never an RGBA struct: unset structs made all particles invisible, L40). Particle mechanics take `color`/`color2`/`size`/`lifetime`(ticks)/`speed`/`amount`/`rise`/`width` → Molang variables via `modules/shared/particle_vars.js`; `projectile`/`rayTraceTo` use `particleOptions`. `telegraph` mechanic = ground warning circle. Converter: MM dust/reddust/dust_color_transition (+color/color2/size ×0.1) and flash/glow → library.

Custom boss bars (L45): framework RP `ui/hud_screen.json` adds a 512×128 image (GUI units, centred on the bar; bar at x 165–347, y 60–65) to the vanilla `boss_health_panel`, texture `textures/behemoth/bossbars/<#bossName>.png`. A missing HUD texture shows a magenta square, so EVERY bar needs an image. Bosses without art keep their colour-free `Display` name plus an empty PNG (`EMPTY_PNG`); the framework ships Wither and Ender Dragon, the demo ships Test Boss. With `<MOB>/bossbar.png`, the converter sets `minecraft:boss` name = `bhmbar_<entity id>` and config `display.barKey` (the framework clears the name tag and ignores `bossBar` titles); the HUD hides the name label for `bhmbar_` names (verified in-game 2026-10-08). `place_boss_bar` composites the art onto a 2048×512 PNG using `behemoth.json` `mobs.<MOB>.bossbar_layout` {width\|scale, x, y} (the documented "finishing touch"). Template `docs/bossbar_template.png` (1024×256 = the 256×64 default area).

Wendigo-era framework pieces: `partVisibility` (config `parts`, property `bhm:hidden_parts` bit mask, persisted, cleared on reset), `grab` (teleport target to a baked bone each tick), `damageCause` condition (onDamaged `data.cause`), `onAttack` also emitted from cancelled vanilla melee (once per tick, `BossManager.emitAttack`). `npm run sim:hits` disables the boss's triggers so only the tested attack runs.

Other runtime features: D6 Peaceful removal, D7 health scaling (incoming damage ÷ `boss.healthScale`, L38) and loot chests (`core/LootChests.js`, explosion before-event, `bhm:lootchests`), stun (`BossInstance.stun`), summon parent link (`bhm:parent` dynamic property → `@Parent`), `damageModifiers`, `death.event` + `removeAfter` backstop, `baseStates` (`bhm:idle_state`/`bhm:walk_state`), `restPose`, facing lock, persisted speed multiplier, timed summons, reset/leash (`onReset`), script-level invulnerability, no boss-vs-boss damage (`ai.friendlyFire` opt-in), `tempBlocks` (air only, mobGriefing, restored across reloads), compact baked tracks (`TrackCodec`: `{q, n, d: base64 int16}`).

MythicMobs → Behemoth translation rules (converter `mythic.py`):
- Metaskill `Cooldown` is SECONDS (×20). Delays, timers and `gcd` are ticks.
- `TargetConditions distance` and `targetwithin` map to caster→target `distance`.
- `@modelpart{o=model}` offsets are in the model yaw frame; ModelEngine −Z forward → entity space +Z forward.
- Job `blades: [bone]` → `<bone>_tip` baked; totems become hilt→tip capsules (`hitbox{to}`), summons land at the tip; YAML offsets on blades dropped.
- `totem` → `hitbox` (`ti` = re-hit interval [VERIFY]); `throw`/`pull` velocities ÷10 [VERIFY]; projectile `v` blocks/second → /20 per tick [VERIFY]; `potion level` = amplifier; Java particle names via `MM_PARTICLES` (+ job `particles`).
- `model`, `BodyClamp`, `CancelEvent` skipped; unreachable metaskills not converted. Everything dropped/approximated is in `<boss>.report.md` — read it after every conversion.
- Job `minions`: other mobs of the same pack (minions, effect mobs) converted alongside the boss — same keys as the boss (`boss`, `mob`, `behavior`, `client_entity`, `geometry`, `animations`, `textures`, …) plus optional `identifier` (several mobs can share one model). Summons of them map automatically; MM `NoAI` → `ai.default: "frozen"`, `Invincible` → config `invulnerable`. Job `bullets`: projectile `bulletModel`/`bulletMaterial` → entity id flown by `projectile{bullet}`.
- Converter also maps: inline skill lists (`oH=[ - … ]` → generated skills `<skill>_<n>_<key>`), `?`/`?!` inline conditions, line chance, `<N%` mob-line health modifiers, `castinstead`/`orelsecast`, `TargetConditions` → `targetIf`, mob `Variables`, `world.` → `global.` scope, `repeat`/`repeati`, per-mechanic `cd` (seconds → line `cooldown`), `basedamage` (× mob `Damage`), relative velocity (x mirrored [VERIFY]). Options keep `<placeholders>` (never float() them: use `_num`).
- Job keys for raw Blockbench/ModelEngine packs: `link_all_animations` (register animations the client entity doesn't list), `always_animate` (looping layers the RP always plays, e.g. `passive`; `state` lines for them are dropped), `sound_files` {folder, event_prefix, mm_namespace, dest} (.ogg → RP sounds + sound_definitions.json; `growl_1/_2` = one event), `pack_icon`; tuning `option_overrides` {skill: {mechanic: {opt: v}}}. Keyframe `mm:SKILL;` timeline hooks: sound-only skills → animation sound_effects, others dropped (L43). ModelEngine bone prefixes (`h_`, `p_`, …) resolve automatically. `partvis` → `partVisibility` + config `parts` + generated render controller (L41); `MountModel` → `grab` for the delays until `DismountAll` (L42); all-caps summon names map to vanilla only if in `VANILLA_MOBS`.
- Job `pack` = name/id/version + UUIDs (generated once, written back to the job — never regenerate them). Job `tuning` = Bedrock-side tweaks (stop_distance, damage_multiplier, ignore_difficulty, randomskill_mode, trigger_overrides, extra_lines + extra_lines_enabled, leash_range, reset_after_no_players). Dark Knight camera shakes are defined but DISABLED (owner, 2026-10-05).

## Behemoth-ready entity stub (design doc §5)

Every boss entity JSON must contain:
- Component groups + events: `bhm:idle`/`bhm:set_idle`, `bhm:chase`/`bhm:set_chase`, `bhm:frozen`/`bhm:set_frozen`, `bhm:invulnerable`/`bhm:invuln_on`+`bhm:invuln_off` (kept for compatibility; the framework no longer toggles it — L31), `bhm:despawn`.
- Properties: `bhm:phase` (int), `bhm:visibility`, `bhm:anim_speed` (float), optional `bhm:idle_state`/`bhm:walk_state`.
- `minecraft:boss` WITH `name` (else "Unknown"), health/collision/knockback/scale per config, `minecraft:persistent`, family incl. `bhm_boss`.
- Chase AI = `nearest_attackable_target` + `hurt_by_target` (players only) + `melee_attack` (pathfinding) + `minecraft:attack`; vanilla melee damage cancelled by the framework unless `ai.vanillaMelee: true`. Never `move_towards_target`.
- Facing is framework-owned (`lookAt` every tick; `ai.faceTarget: false` to opt out). `setSpeed` multiplies `stats.movementSpeed`; `ai.stopDistance` holds position near the target.
- Bedrock scales mob damage to players by difficulty (Easy x/2+1, measured); `stats.ignoreDifficulty` undoes it; `stats.damageMultiplier` scales all damage.
- Boss packs use their own namespace for entity ids (e.g. `bhm_demo:test_boss`, `boss:dark_knight`); `bhm:` is the framework's.

## Animation & baking (design doc §6, §9)

- `playAnimation` with controllers `bhm_base`, `bhm_action`, `bhm_overlay`.
- Converter FK in the raw json frame, R = Rz(−rz)·Ry(ry)·Rx(−rx) (Blockbench import rules, model faces −Z); output entity space (x, y, −z)/16 (+Z forward, +X left). Baked data = bone pivots (+ blade tips), compact-encoded. Verified in-game via the Dark Knight's sword hits.

## Naming

- Framework IDs/events/groups/properties/script events/dynamic properties: `bhm:` prefix. Tags/controllers/families: `bhm_`.
- Command: `/behemoth` (`bhm:behemoth`). Logs: `[BHM]`.
- Files: `snake_case.js` for modules and configs, `PascalCase.js` for core classes.

## Milestones (design doc §14)

- **M0, M1, M2 (done, tested in-game).** **M3:** mostly done (missing: Blockbench timeline markers, `q.anim_time`-only Molang).
- **M4 (current):** v1 modules ✅, reset/leash ✅, library split + protocol + menu ✅ (tested in-game 2026-10-06), minions + removed-pack handling ✅, shared particle library ✅ (2026-10-07, in-game look still to check), weak-point raycast (v1.1).
- **M5:** 2–3 converted bosses end to end; set CPU budget; tag v1.

## Owner & workflow

- Owner: experienced Python full-stack dev; has built Bedrock Script API addons and Forge/Fabric mods. Iterative troubleshooting with exact errors, screenshots and screen recordings (ffmpeg is installed for frame extraction; put videos in `private/`).
- Test environment: Bedrock 1.26.52 (Windows GDK build) + `/reload`; `npm run deploy` then rejoin for entity/RP changes.
- Git: the repo is **public** on GitHub (`origin`, `main`). Never commit anything from `private/` (licensed assets, converted packs, recordings); check `git status` before every push.

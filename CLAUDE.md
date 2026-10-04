# CLAUDE.md — Mythic Bedrock

Persistent context for Claude Code sessions. The **single source of truth** is
[`Mythic Bedrock — Design & Project Documentation.md`](Mythic%20Bedrock%20—%20Design%20&%20Project%20Documentation.md)
(referred to below as "the design doc"). This file is a condensed working guide; when they disagree, the design doc wins — and fix this file.

## What this project is

A JavaScript framework on the Minecraft Bedrock Script API (`@minecraft/server`) that recreates the MythicMobs + ModelEngine boss workflow. One JS config file per boss; mechanics, targeters, conditions and triggers are plug-in modules bound in manager files. Plus an offline **Python converter** that bakes bone tracks / animation data from `.geo.json` + `.animation.json` (+ optional `.bbmodel`).

**Status (2026-10-05):** M1 + M2 done: Dark Knight (`boss:dark_knight`, MythicMobs mob `bl_dark_knight`) converted and tested in-game by the owner, including `/reload`. M4 in progress: reset/leash, profiler and all §13 v1 modules are in; next is the shared particle library and the second real boss (whose YAML decides further modules). The MM stones entity (`bl_dark_knight_stones`) is intentionally NOT converted — the boss summons a `minecraft:pig` stand-in (job file `mob_types`).

## Dev commands

- `npm run check` — type-check all scripts against the pinned `@minecraft/server` typings (`tsc --checkJs`). Catches invented/misspelled API names. Run after every script change.
- `npm run validate` — run the real Validator over every bound boss config in Node (no game needed). Run after every config/module change.
- `npm run deploy` — copy `BP/` and `RP/` into `%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang\development_*_packs` (override with `MB_COM_MOJANG`), then overlays `private/build/{BP,RP}` (converted bosses; `.lang` files appended to en_US.lang).
- `npm run convert -- --job private/<boss>.job.json` — run the converter (writes `private/build/` plus `<boss>.report.md`). `npm run test:converter` — pytest.
- `npm run sim -- <typeId> [ticks] [--hit N] [--distance D] [--walk] [--debug] [--death-event E]` — headless run of the real framework against a `@minecraft/server` stub (`tools/sim/`). Use it to catch runtime errors / broken skill flows before asking the owner to test. No physics or pathing.
- `npm run sim:hits -- <typeId> <skill,skill>` — swings each attack at players placed around the boss (front/sides/behind × 1.5–4.5 blocks) using the real baked tracks, and checks vanilla-melee cancel + walk speed. Run after any change to hitboxes, bones or the converter's bake.
- `npm run sim:scenarios -- [typeId]` — regression scenarios: no friendly fire, custom-death backstop, reload mid-death, reset, leash, script invulnerability, and (test boss) every `demo_*` module skill. Run for both bosses after any core change.
- `npm run test:converter` includes an end-to-end test: the made-up kitchen-sink boss in `converter/tests/fixtures/kitchen/` is converted and checked with `node tools/validate.mjs --config <file>`. Extend its YAML when adding a MythicMobs mapping.
- validate / sim / deploy include `private/build` bosses automatically when present.
- The typings at `node_modules/@minecraft/server/index.d.ts` are the reference for API names — grep them instead of guessing.

## Provisional decisions in use (owner to confirm; see design doc §15)

- D1: everything script-side in the one framework BP.
- D2: `@minecraft/server` **2.10.0**, `min_engine_version` [1, 26, 50] [VERIFY vs owner's game version].
- D9: plain JS + JSDoc + `types/config.d.ts`, checked by `tsc`, no build step.
- D5: no bone tagging — the converter bakes the bones the YAML references via `@modelpart` (+ job `bone_aliases`).

## Before writing any code

1. Check the current milestone (design doc §14) and the open decisions (§15).
2. Re-read §3 (platform limits) and §13 (v1 scope) for the area you're touching.
3. Do not build features from a later milestone than the current one without asking.

## Hard rules (design doc §17)

- **Never invent Script API names.** Anything not confirmed in the pinned `@minecraft/server` typings gets a `// [VERIFY]` comment and is called out in the reply so the owner can check via IDE autocomplete.
- **Stable APIs only.** No beta/experimental modules.
- **Only the adapter layer (`scripts/adapter/`) imports `@minecraft/server`.** Modules and core use the adapter.
- **Mechanics and conditions are stateless** singletons; state lives in `BossInstance` or the execution `ctx`.
- **Every scheduled task carries the boss instance's cancel token.** One central scheduler loop (`system.runInterval`, 1 tick) — no per-skill `runInterval`, no nested `runTimeout` chains. Heavy work → `system.runJob`.
- Check `entity.isValid` before every step that touches an entity. Defer world writes inside before-events with `system.run`.
- **All time values are ticks.** Name ambiguous fields `...Ticks`.
- No dynamic imports: every config/module is a static import + bind line in its manager file.
- Configs: `schemaVersion` required; inline functions only as custom conditions; stay close to MythicMobs naming.
- Deliver complete, runnable files — no partial snippets, no leftover debug output.
- New platform limit found → add a row to design doc §3 (L-number, workaround, status).
- Decision made → move it from §15 into the relevant section marked **[DECIDED]**; update the doc's as-of date. Keep section order; add material to the matching section, never append at the end.

## Architecture (design doc §4)

Five layers, each talks only to the one below:

1. Configs + generated data (`bosses/`, `generated/`)
2. Modules (`modules/mechanics|targeters|conditions|triggers/`, one file each)
3. Registries/managers (`BossManager`, `SkillManager` — `bind("name", Module)`, `bindCondition(...)` etc.)
4. Core runtime (`BossInstance`, `Scheduler`, `EventBus`, `ThreatTable`, `Persistence`, `Validator`, `SkillExecutor`)
5. Adapter (sole caller of `@minecraft/server`)

Module contracts (proposed, finalise in M1, type in `types/config.d.ts`):

| Kind | Shape |
| --- | --- |
| Mechanic | `{ name, requires?, validate(options) → errors[], execute(ctx, targets, options) → void \| delayTicks }` |
| Targeter | `{ name, validate(options), resolve(ctx, options) → (Entity \| Location)[] }` |
| Condition | `{ name, validate(args), test(ctx, target, args) → boolean }` (executor handles negation) |
| Trigger | `{ name, subscribe(bus) }` → emits `{ boss, triggerEntity, data }` |

`ctx` = boss instance, caster, trigger entity, targets, variables, cancel token, adapter.

Skill line keys: `m` mechanic, `o` options, `t` targeter, `tr` trigger(s), `if` conditions (ANDed), `chance`, `c` children; plus `cooldown`, GCD, `exclusive`, `interruptible`. Parsed and validated once at startup.

A module declares `requires: [...]`; missing deps disable that skill with a warning, the rest of the boss still runs.

## Layout

```
BP/  manifest.json, entities/, scripts/{main.js, adapter/, core/, registry/, modules/, bosses/, generated/, types/, debug/}
RP/  entity/, animations/, texts/ (later: particles/ shared library, render_controllers/, models/, textures/)
tools/  validate.mjs, deploy.mjs, sim/ (Node)
converter/  Python converter: convert.py (entry), mbconv/{keyframes,bake,mythic,entity,jsout,cli}.py, tests/
private/  (git-ignored) licensed sources + <boss>.job.json; private/build/ = converter output overlay
```

Key runtime files:
- `scripts/main.js` — builds the `services` container, binds modules + bosses, validates, starts the scheduler, registers debug commands.
- `scripts/adapter/Adapter.js` — the only `@minecraft/server` import.
- `scripts/registry/SkillManager.js` — registries **and** the module binding list (`bindModules`). Add a module = new file + import + bind line.
- `scripts/bosses/index.js` — boss binding list (`bindBosses`). Add a boss = config file + import + bind line.
- `scripts/core/` — `BossManager` (events → bus, instances, persistence, drops), `BossInstance` (phase, cooldowns, lock, anim, bone lookup), `SkillExecutor` (runs compiled skills, delays via scheduler), `Validator` (compiles configs at startup), `SkillParser`, `Scheduler` (+`CancelToken`), `EventBus`, `ThreatTable`, `Persistence`, `Random` (seedable), `Logger`, `vec.js`.
- Modules get everything through `ctx.services` (adapter, scheduler, bus, bosses, executor, random, log). They may import the pure helpers `core/vec.js` and `core/SkillParser.js` (`compare`) and `modules/shared/*` (e.g. `deal_damage.js` — always use it for damage so damageMultiplier/ignoreDifficulty/debug logging apply), nothing else from core.
- The test boss has trigger-less `demo_*` skills showcasing every module; run them in-game with `/mb:skill demo_<name>`.
- `generated/test_boss/*.js` are hand-written stand-ins in converter output format.
- `bosses/private/index.js` is a committed EMPTY stub; the real one (plus converted boss configs and generated data) exists only in `private/build/` and the deployed game folder. Never commit anything from `private/`.

Execution semantics implemented:
- Skill = trigger → skill `if`/`chance`/cooldown → steps in order. A mechanic returning N > 0 pauses the run N ticks.
- A line with `delay: N` fires N ticks later WITHOUT pausing the sequence (MythicMobs per-mechanic `delay=`).
- Lines without `t` use targets inherited from the calling skill (`skill`/`randomSkill`/`aura`/`hitbox`), else the mechanic's default targeter. An explicit targeter that finds nothing skips the line (MythicMobs behaviour).
- `skill`/`randomSkill` respect the called skill's cooldown and conditions; phase `onEnter`, `aura` ticks, `hitbox` hits and debug `/mb:skill` force.
- `exclusive` skills take the cast lock and respect `config.gcd`. The `gcd` mechanic + `offGcd` condition give MythicMobs-style GCD.
- `state{lock:true}` holds the lock until anim end; `interruptible` runs are cancelled on phase change.
- Death cancels everything, then `onDeath` skills run for up to 100 ticks.

Other runtime features: `damageModifiers` (MythicMobs DamageModifiers via the stable `entityHurt` before-event; negative heals), `death.event` (custom entity-JSON death, L25), `baseStates` + `mb:idle_state`/`mb:walk_state` (generated RP base controller), `restPose` (bone fallback while idle/walk play client-side), facing lock, speed multiplier (both persisted), timed summons (`summon{lifetime}`).

MythicMobs → Mythic Bedrock translation rules (converter `mythic.py`):
- Metaskill `Cooldown` is SECONDS (×20). Delays, timers and `gcd` are ticks.
- `TargetConditions distance` and `targetwithin` both map to our caster→target `distance`.
- `@modelpart{o=model}` offsets are in the model's yaw frame; ModelEngine −Z forward → entity space +Z forward (x and z negated).
- Job `blades: [bone]`: that bone's farthest cube corner is baked as `<bone>_tip`; totems on it become a hilt→tip capsule (`hitbox{to}`) and other mechanics (e.g. summons) target the tip; YAML offsets on blades are dropped (L28).
- `totem` → `hitbox` (`ti` read as the per-target re-hit interval [VERIFY]); `throw` velocities ÷10 [VERIFY]; `potion level` = amplifier; `lockmodel` → `lockFacing`; `defaultstate` → `baseState`.
- `model`, `BodyClamp`, `CancelEvent` are skipped. Metaskills not reachable from the mob's skill lines (e.g. another mob's) are not converted.
- Unsupported items are dropped and listed in `private/build/<boss>.report.md` — read it after every conversion.
- Job `tuning` = Bedrock-side adjustments NOT in the YAML (all reported): `stop_distance`, `damage_multiplier`, `randomskill_mode` (`available` = only pick skills that can fire now), `trigger_overrides` (`{metaskill: "onTimer:10"}` for the mob lines calling it), `extra_lines` (`{metaskill: [lines]}` prepended; time them with `delay`), `extra_lines_enabled` (false = keep them in the job but do not apply). The Dark Knight's camera shakes are defined there and currently DISABLED at the owner's request (2026-10-05). Put boss feel tweaks here, never in generated files.

Debug commands (cheats on): `/mb:spawn <boss>`, `/mb:skill <name>`, `/mb:phase <id>`, `/mb:despawn`, `/mb:reset`, `/mb:perf`, `/mb:debug [on]`, `/mb:bones [on]`, `/mb:seed [n]`.

Boss safety rules (learned in testing): bosses never damage each other (`ai.friendlyFire` opt-in); invulnerability is script-level — NEVER toggle stub component groups that define components the owner's entity also has (L31); custom-death bodies are removed by a backstop (`death.removeAfter`); `ai.leashRange` / `ai.resetAfterNoPlayers` reset a boss (heal, phase 1, clear threat/cooldowns, back to spawn, `onReset`); `tempBlocks` only replace air, respect mobGriefing and are persisted in the world property `mb:tempblocks` so reloads restore them.

## Mythic-ready entity stub (design doc §5)

Every boss entity JSON must contain:
- Component groups + events: `mb:idle`/`mb:set_idle`, `mb:chase`/`mb:set_chase`, `mb:frozen`/`mb:set_frozen`, `mb:invulnerable`/`mb:invuln_on`+`mb:invuln_off`, `mb:despawn`/`mb:despawn`.
- Properties: `mb:phase` (int), `mb:visibility`, `mb:anim_speed` (float), optional `mb:state` (enum). Keep the set small.
- `minecraft:boss`, health/collision/knockback resistance/scale per config, `minecraft:persistent`.
- Base `minecraft:damage_sensor` with fall immunity (leaps). The `mb:invulnerable` group's sensor replaces it while active.
- Facing is framework-owned: `BossInstance.faceTarget()` calls `lookAt` on the target every tick (`ai.faceTarget: false` to opt out).
- Optional ints `mb:idle_state` / `mb:walk_state` when the boss uses `baseStates` (the converter adds them).
- RP: render controller reading `mb:` props; `anim_time_update` using speed property. Converted bosses get `controller.animation.<boss>.mb_base` first in `scripts.animate`.
- Chase AI = `nearest_attackable_target` + `hurt_by_target` + `melee_attack` (pathfinding) + `minecraft:attack`; the vanilla melee damage is cancelled by the framework unless `ai.vanillaMelee: true` (L27). Never use `move_towards_target` (its `within_radius` keeps the mob AWAY).
- `minecraft:boss.name` must be set (else the bar shows "Unknown"); the converter uses the MythicMobs Display name.
- Speed: `setSpeed` multiplies `config.stats.movementSpeed` (converter copies the entity's `minecraft:movement` value). `ai.stopDistance` makes the boss hold position near its target (no pushing into players); multipliers > 1 (lunges) are exempt.
- Bedrock scales mob damage to players by difficulty (Easy: x/2+1, measured). `stats.ignoreDifficulty` (job tuning `ignore_difficulty`) undoes it. `stats.damageMultiplier` scales every `damage` mechanic. With `/mb:debug on`, each hit logs `damage N → player: hp a → b`.
- The converter's behavior patch also removes `minecraft:despawn` and `minecraft:equipment`, raises format_version to 1.21.0 and turns boolean `deals_damage` into "yes"/"no". The owner's own groups/events (e.g. the death sequence) are kept.

## Animation & baking (design doc §6, §9)

- `playAnimation` with controller names `mb_base`, `mb_action`, `mb_overlay` (same name = override).
- Animation end = `startTick + length` from baked data → scheduler fires `animEnd`.
- Baked bone runtime lookup: `t = now - startTick` (clamp/wrap) → offset → × scale → rotate around Y by body yaw → + location.
- Converter: 16 units = 1 block, 20 samples/s, round to 3 decimals, only referenced bones, numeric keyframes only (any Molang → bone reported unbakeable). FK in the raw json frame with R = Rz(−rz)·Ry(ry)·Rx(−rx) (Blockbench import rules, model facing −Z); output entity space (x, y, −z)/16 (+Z forward, +X left). Baked data = bone PIVOT positions; targeter offsets are applied in the yaw frame at runtime.
- **Biggest project risk is the coordinate math** (X mirroring, Euler order, `getRotation().y` vs rendered yaw — all [VERIFY]). The bone-marker calibration debug mode comes first.

## Naming

- Framework IDs/events/groups/properties: `mb:` prefix. Baked bones: `mb_` prefix (pending D5).
- Files: `snake_case.js` for modules and configs, `PascalCase.js` for core classes.
- Logs: `[MB]` prefix with level (error/warn/info/debug).

## Milestones (design doc §14) — next starts only when exit check passes

- **M0:** settle D1–D4 (D1/D2/D9 provisional, D3 defaults implemented, D4 open); pin API version; check [VERIFY] items affecting stub/core; repo + pack skeletons.
- **M1 (done, tested in-game):** adapter, scheduler + cancel tokens, event bus, BossManager/SkillManager, BossInstance, persistence, validator, `config.d.ts`, debug commands, log levels.
- **M2 (done, tested in-game):** stub on one boss; minimal converter (lengths, one baked bone); ~10 MVP modules (state, damage, leap, particle, particleRing, sound, delay, setAI, summon, phase change); bone-marker calibration; first profiling.
- **M3:** full converter (interpolation modes, Molang, unbakeable detection, markers/hit frames, entity patch, config skeleton, report, pytest).
- **M4 (current):** remaining v1 modules, bone hit-sphere attacks, reset/leash, threat table, particle library, overlay.
- **M5:** convert 2–3 purchased bosses end to end; set CPU budget; tag v1.

## Open decisions (design doc §15)

D1 pack layout · D2 API version + `min_engine_version` · D3 execution rules · D4 licensing of purchased packs · D5 bone tagging · D6 boss family / Peaceful · D7 player scaling & drops · D8 CPU budget · D9 plain JS + JSDoc/.d.ts vs TypeScript.
Don't silently pick an answer for an open decision — ask the owner, then record it as [DECIDED] in the design doc.

## Owner & workflow

- Owner: experienced Python full-stack dev; has built Bedrock Script API addons (incl. a scripted boss and a mob-skills system) and Forge/Fabric mods.
- Troubleshooting is iterative with exact error messages and IDE screenshots.
- Test environment: Bedrock Dedicated Server + VS Code Minecraft Debugger; `/reload` for iteration.
- Git: the repo is **public** on GitHub (`origin`, branch `main`). Commit meaningful units of work with clear messages. Purchased boss assets (models, textures, MM YAML) must never be committed (licensing, D4) — keep them under `private/` (git-ignored) and check `git status` before every push.

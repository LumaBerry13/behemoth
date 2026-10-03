# CLAUDE.md — Mythic Bedrock

Persistent context for Claude Code sessions. The **single source of truth** is
[`Mythic Bedrock — Design & Project Documentation.md`](Mythic%20Bedrock%20—%20Design%20&%20Project%20Documentation.md)
(referred to below as "the design doc"). This file is a condensed working guide; when they disagree, the design doc wins — and fix this file.

## What this project is

A JavaScript framework on the Minecraft Bedrock Script API (`@minecraft/server`) that recreates the MythicMobs + ModelEngine boss workflow. One JS config file per boss; mechanics, targeters, conditions and triggers are plug-in modules bound in manager files. Plus an offline **Python converter** that bakes bone tracks / animation data from `.geo.json` + `.animation.json` (+ optional `.bbmodel`).

**Status (2026-10-03):** design complete, no code written. Current milestone: **M0** (see below).

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

## Planned layout

```
BP/  manifest.json, entities/, scripts/{main.js, adapter/, core/, registry/, modules/, bosses/, generated/, types/, debug/}
RP/  particles/ (shared, Molang-driven), render_controllers/, entity/, models/, animations/, textures/
converter/  Python CLI + unit tests
```

## Mythic-ready entity stub (design doc §5)

Every boss entity JSON must contain:
- Component groups + events: `mb:idle`/`mb:set_idle`, `mb:chase`/`mb:set_chase`, `mb:frozen`/`mb:set_frozen`, `mb:invulnerable`/`mb:invuln_on`+`mb:invuln_off`, `mb:despawn`/`mb:despawn`.
- Properties: `mb:phase` (int), `mb:visibility`, `mb:anim_speed` (float), optional `mb:state` (enum). Keep the set small.
- `minecraft:boss`, health/collision/knockback resistance/scale per config, persistence component [VERIFY].
- RP: render controller reading `mb:` props; `anim_time_update` using speed property.

## Animation & baking (design doc §6, §9)

- `playAnimation` with controller names `mb_base`, `mb_action`, `mb_overlay` (same name = override).
- Animation end = `startTick + length` from baked data → scheduler fires `animEnd`.
- Baked bone runtime lookup: `t = now - startTick` (clamp/wrap) → offset → × scale → rotate around Y by body yaw → + location.
- Converter: 16 units = 1 block, 20 samples/s, round to 3 decimals, only tagged bones, Molang only if it depends solely on `q.anim_time` (else mark unbakeable).
- **Biggest project risk is the coordinate math** (X mirroring, Euler order, `getRotation().y` vs rendered yaw — all [VERIFY]). The bone-marker calibration debug mode comes first.

## Naming

- Framework IDs/events/groups/properties: `mb:` prefix. Baked bones: `mb_` prefix (pending D5).
- Files: `snake_case.js` for modules and configs, `PascalCase.js` for core classes.
- Logs: `[MB]` prefix with level (error/warn/info/debug).

## Milestones (design doc §14) — next starts only when exit check passes

- **M0 (current):** settle D1–D4; pin API version; check [VERIFY] items affecting stub/core; repo + pack skeletons.
- **M1:** adapter, scheduler + cancel tokens, event bus, BossManager/SkillManager, BossInstance, persistence, validator, `config.d.ts`, debug commands, log levels.
- **M2:** stub on one boss; minimal converter (lengths, one baked bone); ~10 MVP modules (state, damage, leap, particle, particleRing, sound, delay, setAI, summon, phase change); bone-marker calibration; first profiling.
- **M3:** full converter (interpolation modes, Molang, unbakeable detection, markers/hit frames, entity patch, config skeleton, report, pytest).
- **M4:** remaining v1 modules, bone hit-sphere attacks, reset/leash, threat table, particle library, overlay.
- **M5:** convert 2–3 purchased bosses end to end; set CPU budget; tag v1.

## Open decisions (design doc §15)

D1 pack layout · D2 API version + `min_engine_version` · D3 execution rules · D4 licensing of purchased packs · D5 bone tagging · D6 boss family / Peaceful · D7 player scaling & drops · D8 CPU budget · D9 plain JS + JSDoc/.d.ts vs TypeScript.
Don't silently pick an answer for an open decision — ask the owner, then record it as [DECIDED] in the design doc.

## Owner & workflow

- Owner: experienced Python full-stack dev; has built Bedrock Script API addons (incl. a scripted boss and a mob-skills system) and Forge/Fabric mods.
- Troubleshooting is iterative with exact error messages and IDE screenshots.
- Test environment: Bedrock Dedicated Server + VS Code Minecraft Debugger; `/reload` for iteration.
- Git: commit meaningful units of work with clear messages. Purchased boss assets (models, textures, MM YAML) must not be committed to a public remote (licensing, D4) — keep them under `private/` (git-ignored).

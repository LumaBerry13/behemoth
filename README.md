# Mythic Bedrock

A boss framework for **Minecraft Bedrock Edition**, built on the Script API (`@minecraft/server`), that recreates the **MythicMobs + ModelEngine** boss workflow.

A boss is one JavaScript config file. Mechanics, targeters, conditions and triggers are plug-in modules, so new behaviour is added as a new module, not by changing the core.

> **Status:** early development (milestone M1). The core runtime and a first set of modules work in-game with a test boss. The converter tool is not started yet, and no real boss has been ported.

## Features

- **One file per boss:** health, phases, skills, drops and animations live in a single config.
- **MythicMobs-style skill lines:** trigger → conditions → targeter → mechanic, with delays, cooldowns, a global cooldown, a cast lock and nested child skills.
- **Plug-and-play modules:** each mechanic, targeter, condition and trigger is its own file with one bind line.
- **Phases:** health thresholds, skills that run on entering a phase, and entity properties set per phase.
- **Animation timing:** animations play through `playAnimation`, and named markers (such as `slam_impact`) drive hit timing.
- **Threat table:** players who deal more damage get targeted first.
- **Persistence:** boss state survives chunk unloads, world reloads and `/reload`.
- **Validation:** configs are checked at startup, and offline with `npm run validate`. A broken skill is disabled with a clear message, and the rest of the boss still works.
- **Debug tools:** in-game commands, an action-bar overlay and a seedable RNG for replaying fights.

### Modules included

| Kind | Modules |
| --- | --- |
| Mechanics | `state`, `damage`, `leap`, `particle`, `particleRing`, `sound`, `delay`, `setAI`, `summon`, `phase`, `message`, `waitMarker`, `skill`, `invulnerable` |
| Targeters | `@self`, `@target`, `@trigger`, `@PlayersInRadius`, `@EntitiesInRadius`, `@NearestPlayer`, `@SelfLocation`, `@TargetLocation` |
| Conditions | `healthPct`, `distance`, `chance`, `phase`, `hasTarget`, `hasTag` (any can be negated with `!`) |
| Triggers | `onSpawn`, `onTimer:N`, `onDamaged`, `onDeath`, `onAttack`, `onPhase:N`, `animEnd`, `onMarker:name` |

## Requirements

- Minecraft Bedrock **1.26.50 or newer**.
- Script API: `@minecraft/server` **2.10.0** (stable APIs only, no beta or experimental toggles).
- [Node.js](https://nodejs.org/) for the dev tooling.

## Getting started

```bash
git clone https://github.com/LumaBerry13/mythic-bedrock.git
cd mythic-bedrock
npm install
npm run deploy
```

`npm run deploy` copies `BP/` and `RP/` into the development pack folders of the Windows game (`%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang`). To deploy somewhere else, such as a Bedrock Dedicated Server, set `MB_COM_MOJANG` to that `com.mojang` folder first.

Then:

1. Create a world with **cheats on** and enable both packs: **Mythic Bedrock BP** and **Mythic Bedrock RP**.
2. Run `/mb:spawn mb:boss` to spawn the test boss, and `/mb:debug on` to see its phase, cooldowns and target.
3. After changing scripts, run `/reload`. After changing entity or resource-pack files, rejoin the world.

### Debug commands

| Command | Effect |
| --- | --- |
| `/mb:spawn <boss>` | Spawn a boss at your position |
| `/mb:skill <name>` | Force a skill on the nearest boss, ignoring cooldowns and conditions |
| `/mb:phase <id>` | Force a phase on the nearest boss |
| `/mb:despawn` | Remove the nearest boss without drops or death skills |
| `/mb:debug [on]` | Toggle debug logs and the action-bar overlay |
| `/mb:bones [on]` | Toggle particle markers on baked bones (for calibration) |
| `/mb:seed [n]` | Seed the RNG so a fight can be replayed; omit `n` to unseed |

### Dev scripts

| Script | Purpose |
| --- | --- |
| `npm run check` | Type-checks every script against the pinned `@minecraft/server` typings. Catches misspelled or non-existent API names. |
| `npm run validate` | Runs the framework's real config validator in Node, without the game. |
| `npm run deploy` | Copies the packs into the game's development pack folders. |

## Writing a boss

A boss config goes in `BP/scripts/bosses/` and is bound with one line in `BP/scripts/bosses/index.js`. All durations are in ticks (20 ticks = 1 second).

```js
export default {
  schemaVersion: 1,
  id: "mb:test_boss",                 // entity type ID
  display: { name: "§cTest Boss" },
  stats: { health: 300 },
  animations: anims,                  // generated animation data
  ai: { default: "chase", targetRange: 32 },
  phases: [
    { id: 1, untilHealthPct: 50 },
    { id: 2, onEnter: ["enrage"] },
  ],
  skills: {
    slam: {
      tr: "onTimer:20",
      if: ["hasTarget", "distance<=5"],
      cooldown: 100,
      exclusive: true,
      c: [
        { m: "setAI", o: { mode: "frozen", ticks: 45 } },
        { m: "state", o: { anim: "slam", lock: true } },
        { m: "waitMarker", o: { marker: "slam_impact" } },
        { m: "damage", o: { amount: 8 }, t: "@EntitiesInRadius{r=4}" },
        { m: "particleRing", o: { particle: "minecraft:basic_flame_particle", radius: 4 } },
      ],
    },
    // ...
  },
  drops: [{ item: "minecraft:diamond", amount: [2, 5], chance: 1 }],
};
```

| Key | Meaning |
| --- | --- |
| `tr` | Trigger(s), e.g. `onTimer:20` or `onDamaged` |
| `if` | Conditions, all of which must pass, e.g. `distance<=5`, `!hasTarget`, `phase==2` |
| `m` / `o` / `t` | Mechanic, its options, and its targeter |
| `c` | Child lines, run in order. A mechanic such as `delay` pauses the sequence. |
| `cooldown`, `chance` | Per-skill cooldown (ticks) and probability (0–1) |
| `exclusive` | Takes the cast lock: no other exclusive skill runs at the same time |
| `interruptible` | The skill is cancelled when the boss changes phase |

The full schema is typed in [`BP/scripts/types/config.d.ts`](BP/scripts/types/config.d.ts). A complete example is [`BP/scripts/bosses/test_boss.js`](BP/scripts/bosses/test_boss.js).

### Boss entity requirements

A script can only toggle components and properties that the entity JSON already defines. So every boss entity needs the standard **Mythic-ready stub**: the `mb:idle`, `mb:chase`, `mb:frozen`, `mb:invulnerable` and `mb:despawn` component groups and their events, plus the `mb:phase`, `mb:visibility` and `mb:anim_speed` properties. See [`BP/entities/test_boss.json`](BP/entities/test_boss.json) for a working example.

## Adding a module

1. Create a file under `BP/scripts/modules/<mechanics|targeters|conditions|triggers>/`.
2. Import it and add one bind line in [`BP/scripts/registry/SkillManager.js`](BP/scripts/registry/SkillManager.js).

```js
// modules/mechanics/heal.js
export default {
  name: "heal",
  defaultTargeter: "@self",
  validate: (o) => (typeof o.amount === "number" ? [] : ["`amount` is required"]),
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t)) a.setHealth(t, a.getHealth(t).current + o.amount);
  },
};
```

Rules for modules:
- Don't import `@minecraft/server` directly; go through `ctx.services.adapter`.
- Keep modules stateless; store state on the boss instance.
- To pause the skill sequence, return a number of ticks from `execute`.

## Project layout

```
BP/                     behavior pack
  entities/             boss entity JSON (with the Mythic-ready stub)
  scripts/
    main.js             entry point
    adapter/            the only code that calls @minecraft/server
    core/               boss manager, boss instances, scheduler, event bus,
                        skill executor, validator, persistence, threat table
    registry/           module registries and the module bind list
    modules/            mechanics, targeters, conditions, triggers
    bosses/             boss configs and the boss bind list
    generated/          animation data (converter output)
    types/              config schema (.d.ts)
    debug/              debug commands and overlay
RP/                     resource pack (client entity, animations, text)
tools/                  validate.mjs, deploy.mjs
```

## Roadmap

| Milestone | Scope |
| --- | --- |
| M1 (current) | Core runtime, validator, persistence, debug tools |
| M2 | First real boss, minimal converter, bone-position calibration |
| M3 | Full Python converter: bakes bone tracks, extracts markers, generates the entity patch and a config skeleton |
| M4 | Remaining v1 modules, bone hit-spheres, reset and leash logic, shared particle library |
| M5 | 2–3 purchased bosses converted end to end, then tag v1 |

The full design, platform limits and open decisions are in [`Mythic Bedrock — Design & Project Documentation.md`](Mythic%20Bedrock%20—%20Design%20&%20Project%20Documentation.md).

## Note on boss assets

Purchased MythicMobs and ModelEngine packs are usually licensed for personal use and can't be redistributed. This repository contains **only the framework** and a test boss that uses the vanilla zombie model. Keep purchased models, textures and YAML in the git-ignored `private/` folder.

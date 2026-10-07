# Behemoth

A boss framework for **Minecraft Bedrock Edition**, built on the Script API (`@minecraft/server`).

Install the framework once. After that, every boss pack is just a boss config, its model and animations, plus a
small standard connector script. The framework validates, runs and drives every boss from every installed pack. It
also comes with a Python converter that turns MythicMobs + ModelEngine bosses into Behemoth boss packs.

> **Status:** early development (v0.2.0). The first real converted boss has been tested in-game. The framework has
> 47 mechanics, 14 targeters, 13 conditions and 11 triggers.

## How it fits together

```
┌──────────────────────────────┐    script events     ┌───────────────────────────┐
│ Behemoth (framework, BP+RP)  │◀────────────────────▶│ Boss pack (BP+RP)         │
│ runtime · modules · /behemoth│  hello / need / part │ config + connector.js     │
│ cache of every boss pack     │       / ack          │ entity, model, animations │
└──────────────────────────────┘                      └───────────────────────────┘
```

- **Install the framework once.** Boss packs declare it as a manifest dependency, so the game won't enable one
  without it.
- **Boss packs hold no framework code.** Their script is a config plus `connector.js`.
- **Fast reloads (cache-first).** When a boss pack is new or updated, its config is streamed to the framework once
  and cached in the world. On every `/reload` or world load after that, the framework restores all bosses from its
  cache in its first tick: under a millisecond in tests, with nothing re-sent. The pack only says hello.
- **Safe transfers.** Each payload carries a checksum and a protocol version, and a framework older than the pack
  needs refuses it with a clear reason. Players can't fake registrations with `/scriptevent`. Two packs can't claim
  the same boss.

## Features

- **One file per boss:** health, phases, skills, drops and animations in a single config.
- **Skill system:** skill lines run trigger → conditions → targeter → mechanic, with delays, cooldowns, a global
  cooldown, a cast lock, child skills and inherited targets.
- **Phases:** health thresholds, skills on entering a phase, and per-phase entity properties.
- **Baked bone tracks:** hits and effects follow the actual model, for example a sword's hilt-to-tip hitbox.
- **Threat, reset and leash:** threat-based targeting; a boss resets when players leave or it's dragged too far.
- **Variables and placeholders:** caster/target/skill/global variables, `<caster.var.x>`, `<caster.hp>`,
  `<random.float.0.9to1.2>` and more inside any option.
- **Projectiles and effect entities:** projectiles can fly a model entity and run skills as they tick, hit and land;
  summoned effects (telegraphs, slashes) know their boss.
- **Multiplayer:** health scales with the number of players; loot goes into a chest where the boss died, and
  explosions can't destroy it. Bosses are removed on Peaceful.
- **Custom boss bars:** a PNG per boss drawn over the vanilla boss bar ([docs/converting.md](docs/converting.md#6-custom-boss-bar)).
- **Particle library:** coloured dust, sparks, smoke, glows, flashes, shockwave rings, swirls and ground telegraphs
  are built into the framework; skills set colour, size and lifetime per line. See [docs/particles.md](docs/particles.md).
- **Persistence:** fights survive chunk unloads, `/reload` and restarts.
- **Validation:** configs are checked when they register, and offline with `npm run validate`.
- **`/behemoth`:** a chest-style settings menu, described below.

### Modules

| Kind | Modules |
| --- | --- |
| Mechanics | **Combat:** `damage`, `percentDamage`, `heal`, `potion`, `ignite`, `lightning`, `throw`, `knockback`, `pull`, `shieldBreak`, `invulnerable`, `hitbox`, `projectile` · **Movement:** `leap`, `lunge`, `propel`, `velocity`, `teleport`, `teleportBehind`, `setSpeed`, `setAI`, `lockFacing` · **Visual/audio:** `state`, `baseState`, `particle`, `particleRing`, `particleSphere`, `particleLine`, `telegraph`, `partVisibility`, `sound`, `cameraShake`, `setProperty`, `message`, `title`, `actionBar` · **World:** `summon`, `remove`, `tempBlocks` · **Flow:** `delay`, `waitMarker`, `skill`, `randomSkill`, `aura`, `gcd`, `phase`, `setVariable`, `variableMath`, `signal`, `addTag`, `removeTag` · **Other:** `rayTraceTo`, `modifyProjectile`, `setRotation`, `matchRotation`, `stun`, `tint`, `bossBar`, `explosion`, `shoot`, `jump`, `threat`, `setHealth`, `swap`, `forcePull`, `command`, `suicide`, `grab` |
| Targeters | `@self`, `@target`, `@trigger`, `@PlayersInRadius`, `@EntitiesInRadius`, `@NearestPlayer`, `@RandomPlayer`, `@ThreatTable`, `@Cone`, `@Ring`, `@SelfLocation`, `@TargetLocation`, `@Bone`, `@Forward`, `@Origin`, `@Parent`, `@RandomLocationsNearCaster`, `@RandomLocationsNearTarget`, `@MobsInRadius`, `@PlayersInRing`, `@Line`, `@Location`, `@Spawn` |
| Conditions | `healthPct`, `distance`, `chance`, `phase`, `hasTarget`, `hasTag`, `offGcd`, `moving`, `inBlock`, `lineOfSight`, `height`, `altitude`, `playersNearby`, `variable`, `varEquals`, `variableIsSet`, `fieldOfView`, `inCombat`, `directionalVelocity`, `onGround`, `isPlayer`, `onFire`, `crouching`, `sprinting`, `entityType`, `hasEffect`, `damageCause` (any can be negated with `!`, and end in `castInstead <skill>` / `orElseCast <skill>`) |
| Triggers | `onSpawn`, `onLoad`, `onTimer:N`, `onDamaged`, `onDeath`, `onAttack`, `onInteract`, `onCombat`, `onDropCombat`, `onChangeTarget`, `onKillPlayer`, `onPhase:N`, `onSignal:name`, `onReset`, `animEnd`, `onMarker:name` |

## The `/behemoth` menu

One command, for operators, and it works without cheats. It opens a chest UI with a gray and black glass border:

- **Settings:**
  - Debug overlay, log level, bone markers, hitbox preview.
  - Seeded randomness, for replaying a fight exactly.
  - Icon set: vanilla or your own icons.
  - Performance: framework milliseconds per tick.
  - Settings are saved in the world.
- **Spawn a boss:** every registered boss (minions are not listed); click one to spawn it.
- **Bosses in world:** every boss in the world with its coordinates, nearest first (also unloaded ones). Open one for live status, reset, despawn, previous/next phase, casting any skill, or teleporting to it.
- **Boss packs:** version, cache or transfer state, and errors for each pack.
- **Diagnostics:** measures the real script-event size limit and delivery delay, and clears the cache.

Custom icons are optional. See [docs/menu-icons.md](docs/menu-icons.md) for the file names.

## Requirements

- Minecraft Bedrock **1.26.50 or newer**.
- Script API: `@minecraft/server` **2.10.0** and `@minecraft/server-ui` **2.2.0**. Stable APIs only; no experimental
  toggles needed.
- For development: [Node.js](https://nodejs.org/), and Python 3.10+ for the converter.

## Getting started (development)

```bash
git clone https://github.com/LumaBerry13/behemoth.git
cd behemoth
npm install
npm test
npm run deploy
```

`npm run deploy` copies the framework and every boss pack into the Windows game's development pack folders. To
deploy elsewhere, such as a dedicated server, set `BHM_COM_MOJANG` to that `com.mojang` folder. Then:

1. Enable **Behemoth** (BP + RP) and a boss pack, for example **Behemoth Demo Boss**, on a world.
2. Run `/behemoth` → **Bosses** → click the boss to spawn it.
3. After changing scripts, run `/reload`. After changing entity or resource-pack files, rejoin the world.

### Repository layout

```
packs/behemoth/          the framework (BP + RP) — what users install
packs/behemoth_demo/     example boss pack (test boss with a demo_* skill per module)
connector/connector.js   the connector every boss pack includes (copy unchanged)
connector/framework.json framework UUID/version that boss packs depend on
converter/               Python converter: MythicMobs + ModelEngine → Behemoth boss pack
tools/                   deploy, validate, package, particle library generator, headless simulator (tools/sim)
docs/                    converting guide, menu icon list, particle library
private/                 git-ignored: licensed sources and their converted boss packs
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm test` | Everything below that needs no game: type-check, validation, converter tests, simulator scenarios |
| `npm run check` | Type-checks the scripts against the pinned API typings (catches misspelled API names) |
| `npm run validate` | Runs the framework's real validator over every boss pack's configs |
| `npm run sim:scenarios -- [boss id]` | Headless regression scenarios: registration protocol, reload cache, combat rules, every module, the menu |
| `npm run sim:hits -- <boss id> <skills>` | Hit map of each attack around the boss, using the real baked tracks |
| `npm run sim -- <boss id> [ticks] [--chase] [--debug]` | Runs a fight headless and prints what happened |
| `npm run convert -- --job <job.json>` | Converts a MythicMobs boss into a boss pack |
| `npm run deploy` | Copies all packs into the game's development folders |
| `npm run package` | Builds `.mcaddon` files into `dist/` (private packs into `private/<Boss>/dist/`) |

## Making a boss pack

A boss pack is an ordinary BP + RP:

```
BP/manifest.json                  depends on Behemoth's BP UUID (connector/framework.json) and @minecraft/server
BP/entities/<boss>.json           entity with the Behemoth-ready stub (bhm:* groups, events, properties)
BP/scripts/main.js                connect({ pack, version, minFramework, bosses })
BP/scripts/behemoth/connector.js  copy of connector/connector.js
BP/scripts/bosses/index.js        export default [ ...boss configs ]
RP/...                            model, animations, textures, client entity
```

`packs/behemoth_demo` is a complete working example. Configs must be plain data (JSON): functions can't be sent
between packs, and the connector reports any it finds.

### Converting a MythicMobs boss

Prepare one folder (the MythicMobs YAML, one sub-folder per mob with its Bedrock files, optional
sounds and boss bar image) and run:

```
npm run convert -- private/<Boss> --check   # optional: is everything the YAML uses supported?
npm run convert -- private/<Boss>           # finished pack/BP + pack/RP, dist/<Pack>.mcaddon, report.md
```

[docs/converting.md](docs/converting.md) explains how to prepare the folder: file and folder naming, packs
with several mobs (boss, minions, effect entities), sounds, custom boss bars, optional settings and the
report. The converter completes bare Blockbench behavior files, links animations, adds a scripted death,
packages sounds and gives the pack stable UUIDs. The older job-file mode (`--job`) still works.

## Writing a boss config by hand

All durations are in ticks (20 ticks = 1 second). `packs/behemoth_demo/BP/scripts/bosses/test_boss.js` is a full
example, and the schema is typed in
[`packs/behemoth/BP/scripts/types/config.d.ts`](packs/behemoth/BP/scripts/types/config.d.ts).

```js
export default {
  schemaVersion: 1,
  id: "mypack:knight",                 // entity type id
  display: { name: "Knight" },
  stats: { health: 300 },
  ai: { default: "chase", targetRange: 32, leashRange: 48, resetAfterNoPlayers: 600 },
  phases: [{ id: 1, untilHealthPct: 50 }, { id: 2, onEnter: ["enrage"] }],
  skills: {
    slam: {
      tr: "onTimer:20", if: ["hasTarget", "distance<=5"], cooldown: 100, exclusive: true,
      c: [
        { m: "state", o: { anim: "slam", lock: true } },
        { m: "waitMarker", o: { marker: "impact" } },
        { m: "damage", o: { amount: 8 }, t: "@EntitiesInRadius{r=4}" },
      ],
    },
  },
};
```

| Key | Meaning |
| --- | --- |
| `tr` | Trigger(s), e.g. `onTimer:20` or `onDamaged` |
| `if` | Conditions, all of which must pass, e.g. `distance<=5`, `!hasTarget`, `phase==2` |
| `m` / `o` / `t` | Mechanic, its options, and its targeter |
| `c` | Child lines, run in order. `delay` pauses; a line's own `delay: N` fires it later without pausing. |
| `cooldown`, `chance` | Per-skill cooldown (ticks) and probability (0–1) |
| `exclusive` / `interruptible` | Takes the cast lock / is cancelled on phase change |

## Adding a module (framework)

1. Create a file under `packs/behemoth/BP/scripts/modules/<mechanics|targeters|conditions|triggers>/`.
2. Import it and add one bind line in
   [`registry/SkillManager.js`](packs/behemoth/BP/scripts/registry/SkillManager.js).
3. Module rules:
   - Use `ctx.services.adapter`; never import `@minecraft/server` directly.
   - Keep modules stateless.
   - Use `modules/shared/deal_damage.js` for any damage.

## Roadmap

| Milestone | Scope |
| --- | --- |
| M0 (done) | Decisions, API version pin, repo and pack skeletons |
| M1 (done) | Core runtime: adapter, scheduler, event bus, managers, persistence, validator |
| M2 (done) | Entity stub, minimal converter, first modules, first converted boss tested in-game |
| M3 (mostly done) | Full converter: interpolation modes, Molang sampling, unbakeable-bone detection, entity patch, config skeleton, report, pytest. Missing: Blockbench timeline markers / hit frames, `q.anim_time`-only Molang |
| M4 (current) | v1 modules (done), reset/leash (done), library split (done), minions (done), shared particle library (done) |
| M5 | 2–3 converted bosses end to end, CPU budget, tag v1 |

M3 was built alongside M2 and M4 (the Dark Knight needed most of it), so it
has no separate "done" date.

The full design, platform limits and open decisions are in
[`Behemoth — Design & Project Documentation.md`](Behemoth%20—%20Design%20&%20Project%20Documentation.md).

## Credits and licensing

- **Behemoth itself is not licensed for use yet.** The code is public to read, but all rights are reserved:
  no permission is granted to use, copy, modify or redistribute it. This may change in the future.

- The menu uses [Chest-UI](https://github.com/Herobrine643928/Chest-UI) (CC BY 4.0). See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Purchased MythicMobs and ModelEngine packs are usually licensed for personal use and must not be redistributed.
  This repository contains only the framework, the converter and a demo boss that uses the vanilla zombie model.

// The /behemoth menu: a chest UI (54 slots) with a gray/black glass border.
// Every page = interior content (7×4 slots) + bottom-row controls.
import { Adapter } from "../adapter/Adapter.js";
import { Ui } from "../adapter/Ui.js";
import { icon } from "./icons.js";
import { PROTOCOL } from "../core/Registrar.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{ slot: number, name: string, lore?: string[], icon: string, amount?: number, run?: (p: Player) => unknown }} Item */

const BACK = 45;
const PREV = 48;
const CLOSE = 49;
const NEXT = 50;
/** Interior slots, row by row (rows 1–4, columns 1–7). */
const INTERIOR = [10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 37, 38, 39, 40, 41, 42, 43];

const on = (v) => (v ? "§aEnabled" : "§cDisabled");
const LOG_COLORS = { error: "§c", warn: "§6", info: "§a", debug: "§b" };

export class Menu {
  /**
   * @param {import("../core/services.js").Services} services
   * @param {string} version
   */
  constructor(services, version) {
    this.s = services;
    this.version = version;
  }

  /** @param {Player} player */
  open(player) {
    return this.main(player);
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------
  /** @private @param {string} key */
  icon(key) {
    return icon(key, this.s.settings.iconSet);
  }

  /**
   * Show one page and run the clicked item's action.
   * @private
   * @param {Player} player @param {string} title @param {Item[]} items
   * @param {{ back?: (p: Player) => unknown, prev?: (p: Player) => unknown, next?: (p: Player) => unknown }} [nav]
   */
  async page(player, title, items, nav = {}) {
    const controls = /** @type {Item[]} */ ([
      { slot: CLOSE, name: "§cClose", icon: this.icon("close") },
    ]);
    if (nav.back) controls.push({ slot: BACK, name: "§fBack", icon: this.icon("back"), run: nav.back });
    if (nav.prev) controls.push({ slot: PREV, name: "§fPrevious page", icon: this.icon("back"), run: nav.prev });
    if (nav.next) controls.push({ slot: NEXT, name: "§fNext page", icon: this.icon("next_page"), run: nav.next });

    const used = new Set([...items, ...controls].map((i) => i.slot));
    const border = [];
    for (let slot = 0; slot < 54; slot++) {
      const row = Math.floor(slot / 9);
      const col = slot % 9;
      if (used.has(slot) || !(row === 0 || row === 5 || col === 0 || col === 8)) continue;
      border.push({ slot, name: "§r", icon: this.icon((row + col) % 2 === 0 ? "border_black" : "border_gray") });
    }

    const all = [...border, ...items, ...controls];
    const picked = await Ui.showChest(player, title, all);
    if (picked === undefined || picked === CLOSE) return;
    const item = all.find((i) => i.slot === picked && /** @type {Item} */ (i).run);
    if (item) await /** @type {Item} */ (item).run(player);
    else await this.page(player, title, items, nav); // clicked a pane: stay
  }

  /**
   * Lay `entries` out in the interior, 28 per page.
   * @private
   * @param {Player} player @param {string} title @param {Omit<Item, "slot">[]} entries @param {number} pageNo
   * @param {(p: Player, n: number) => unknown} reopen @param {(p: Player) => unknown} back
   */
  listPage(player, title, entries, pageNo, reopen, back) {
    const pages = Math.max(1, Math.ceil(entries.length / INTERIOR.length));
    const n = Math.min(pageNo, pages - 1);
    const items = entries.slice(n * INTERIOR.length, (n + 1) * INTERIOR.length).map((e, i) => ({ ...e, slot: INTERIOR[i] }));
    return this.page(player, pages > 1 ? `${title} §8(${n + 1}/${pages})` : title, items, {
      back,
      prev: n > 0 ? (p) => reopen(p, n - 1) : undefined,
      next: n < pages - 1 ? (p) => reopen(p, n + 1) : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Main
  // -------------------------------------------------------------------------
  /** @param {Player} player */
  main(player) {
    const st = this.s.settings;
    const perf = this.s.scheduler.perf();
    const toggle = (slot, key, iconKey, name, desc) => ({
      slot, name: `§f${name}`, icon: this.icon(iconKey),
      lore: [`§7${desc}`, "", on(st.data[key]), "§8Click to toggle"],
      run: (p) => { st.toggle(key); return this.main(p); },
    });
    /** @type {Item[]} */
    const items = [
      toggle(10, "overlay", "overlay", "Debug overlay", "Action bar with phase, HP, cooldowns and target of the nearest boss."),
      {
        slot: 11, name: "§fLog level", icon: this.icon("log_level"),
        lore: ["§7How much the framework writes to the content log.", "", `${LOG_COLORS[st.data.logLevel]}${st.data.logLevel}`, "§8Click to cycle: error → warn → info → debug"],
        run: (p) => { st.cycleLogLevel(); return this.main(p); },
      },
      toggle(12, "boneMarkers", "bone_markers", "Bone markers", "Particles at every baked bone (calibration)."),
      toggle(13, "hitboxes", "hitboxes", "Hitbox preview", "Particles along every damage volume while it is active."),
      {
        slot: 14, name: "§fSeeded randomness", icon: this.icon("seed"),
        lore: ["§7Fixed seed so a fight can be replayed exactly.", "", st.data.seed === null ? "§cOff (random)" : `§aSeed ${st.data.seed}`, "§8Click to toggle"],
        run: (p) => { st.set("seed", st.data.seed === null ? 12345 : null); return this.main(p); },
      },
      {
        slot: 15, name: "§fIcon set", icon: this.icon("icon_set"),
        lore: ["§7Menu icons: vanilla textures or your own", "§7(RP textures/behemoth/ui/<name>.png).", "", st.iconSet === "custom" ? "§bCustom" : "§aVanilla", "§8Click to switch"],
        run: (p) => { st.set("iconSet", st.iconSet === "custom" ? "vanilla" : "custom"); return this.main(p); },
      },
      {
        slot: 16, name: "§fPerformance", icon: this.icon("performance"),
        lore: [
          `§7Framework time: §f${perf.avgMs.toFixed(3)} ms/tick §7avg`,
          `§7Worst tick: §f${perf.maxMs} ms §7(last ${perf.window} ticks)`,
          `§7Live bosses: §f${this.s.bosses.all().length}`,
          `§7Pending tasks: §f${perf.pending}`,
          "", "§8Click to refresh",
        ],
        run: (p) => this.main(p),
      },
      {
        slot: 29, name: "§eSpawn a boss", icon: this.icon("bosses"),
        lore: [`§7${this.spawnable().length} boss type(s) available.`, "§8Spawn one at your position"],
        run: (p) => this.spawnList(p, 0),
      },
      {
        slot: 31, name: "§eBosses in world", icon: this.icon("nearest_boss"),
        lore: ["§7Every boss, nearest first, with", "§7coordinates. Open one to edit it", "§7or teleport to it."],
        run: (p) => this.worldBosses(p, 0),
      },
      {
        slot: 33, name: "§eBoss packs", icon: this.icon("packs"),
        lore: [`§7${this.s.registrar.packs.size} pack(s) connected.`, "§8Versions, cache, errors"],
        run: (p) => this.packs(p, 0),
      },
      { slot: 39, name: "§eDiagnostics", icon: this.icon("diagnostics"), lore: ["§7Script-event limits and cache size."], run: (p) => this.diagnostics(p) },
      { slot: 41, name: "§eAbout", icon: this.icon("about"), lore: [`§7Behemoth ${this.version}`], run: (p) => this.about(p) },
    ];
    return this.page(player, "§lBehemoth", items);
  }

  // -------------------------------------------------------------------------
  // Bosses
  // -------------------------------------------------------------------------
  /** Registered boss configs (not minions) whose entity type is installed. @private */
  spawnable() {
    return [...this.s.bosses.configs.values()].filter(
      (c) => (c.config.kind ?? "boss") === "boss" && Adapter.entityTypeExists(c.config.id)
    );
  }

  /** @param {Player} player @param {number} n */
  spawnList(player, n) {
    const entries = this.spawnable().map((c) => {
      const cfg = c.config;
      return {
        name: `§f${cfg.display?.name ?? cfg.id}`, icon: this.icon("boss"),
        lore: [
          `§7${cfg.id}`, `§7Pack: §f${this.s.registrar.owners.get(cfg.id) ?? "?"}`,
          `§7Health: §f${cfg.stats?.health ?? "?"}  §7Phases: §f${cfg.phases?.length ?? 1}  §7Skills: §f${c.skills.size}`,
          "", "§8Click to spawn at your position",
        ],
        run: (p) => {
          if (this.s.bosses.isPeaceful() && !cfg.allowPeaceful) {
            Adapter.message(p, "§c[Behemoth] bosses cannot spawn on Peaceful difficulty");
            return;
          }
          const boss = this.s.bosses.spawn(cfg.id, p.dimension, p.location);
          Adapter.message(p, boss ? `§a[Behemoth] spawned ${cfg.display?.name ?? cfg.id}` : `§c[Behemoth] could not spawn ${cfg.id}`);
        },
      };
    });
    if (!entries.length) entries.push({ name: "§7No bosses available", icon: this.icon("empty"), lore: ["§8Install a boss pack that uses Behemoth."], run: (p) => this.spawnList(p, 0) });
    return this.listPage(player, "§lSpawn a boss", entries, n, (p, k) => this.spawnList(p, k), (p) => this.main(p));
  }

  /** Every boss in the world, nearest first (minions are never listed). @param {Player} player @param {number} n */
  worldBosses(player, n) {
    const list = this.s.bosses.worldList(player.dimension, player.location);
    const dimName = (d) => d.replace("minecraft:", "");
    const entries = list.map((e) => {
      const where = `§7${dimName(e.dim)} §f${Math.round(e.x)} ${Math.round(e.y)} ${Math.round(e.z)}`;
      const dist = Number.isFinite(e.dist) ? `§7${Math.round(e.dist)} blocks away` : "§7other dimension";
      const hp = e.loaded ? Adapter.getHealth(e.boss.entity) : undefined;
      return {
        name: `${e.loaded ? "§f" : "§7"}${e.name}`, icon: this.icon(e.loaded ? "boss_info" : "boss"),
        lore: [
          where, dist,
          ...(e.loaded ? [`§7Health: §f${Math.ceil(hp.current)}/${hp.max}  §7Phase: §f${e.boss.phase}`] : ["§8Not loaded (chunk unloaded)"]),
          "", "§8Click to open",
        ],
        run: (p) => this.bossDetail(p, e.id),
      };
    });
    if (!entries.length) entries.push({ name: "§7No bosses in the world", icon: this.icon("empty"), lore: ["§8Spawn one from the main menu."], run: (p) => this.worldBosses(p, 0) });
    return this.listPage(player, "§lBosses in world", entries, n, (p, k) => this.worldBosses(p, k), (p) => this.main(p));
  }

  /**
   * One boss: live info and edits when loaded; teleport always.
   * @param {Player} player @param {string} id entity id
   */
  bossDetail(player, id) {
    const back = (p) => this.worldBosses(p, 0);
    const boss = this.s.bosses.get(id);
    const known = this.s.bosses.known.get(id);
    if (!boss && !known) return this.worldBosses(player, 0); // gone meanwhile

    /** @type {Item[]} */
    const teleport = [{
      slot: 31, name: "§bTeleport to boss", icon: this.icon("teleport"),
      lore: ["§7Puts you a few blocks away from it,", "§7facing it."],
      run: (p) => {
        const dim = boss ? boss.dimension.id : known.dim;
        const l = boss ? boss.location : known;
        Adapter.teleportTo(p, dim, { x: l.x + 3, y: l.y + 1, z: l.z + 3 }, { x: l.x, y: l.y + 1.5, z: l.z });
        Adapter.message(p, `§a[Behemoth] teleported to ${boss?.config.display?.name ?? known.name}`);
      },
    }];

    if (!boss) {
      return this.page(player, `§l${known.name}`, [
        {
          slot: 13, name: `§7${known.name}`, icon: this.icon("boss"),
          lore: [`§7${known.type}`, `§7${known.dim.replace("minecraft:", "")} §f${Math.round(known.x)} ${Math.round(known.y)} ${Math.round(known.z)}`,
            "", "§8Not loaded. Teleport there to load it;", "§8then you can edit it."],
          run: (p) => this.bossDetail(p, id),
        },
        ...teleport,
        {
          slot: 33, name: "§cForget this entry", icon: this.icon("despawn"),
          lore: ["§7Use if the boss no longer exists", "§7(e.g. removed while unloaded)."],
          run: (p) => { this.s.bosses.forget(id); return back(p); },
        },
      ], { back });
    }

    const cfg = boss.config;
    const h = Adapter.getHealth(boss.entity);
    const now = this.s.scheduler.tick;
    const phases = cfg.phases ?? [];
    const idx = phases.findIndex((ph) => ph.id === boss.phase);
    const target = boss.getTarget();
    const l = boss.location;
    const cds = [...boss.cooldowns].filter(([, at]) => at > now).map(([name, at]) => `§7${name} §f${((at - now) / 20).toFixed(1)}s`);
    const again = (p) => this.bossDetail(p, id);
    /** @type {Item[]} */
    const items = [
      {
        slot: 13, name: `§f${cfg.display?.name ?? cfg.id}`, icon: this.icon("boss_info"),
        lore: [
          `§7${boss.dimension.id.replace("minecraft:", "")} §f${Math.round(l.x)} ${Math.round(l.y)} ${Math.round(l.z)}`,
          `§7Health: §f${Math.ceil(h.current)}/${h.max}`, `§7Phase: §f${boss.phase}  §7AI: §f${boss.aiMode}`,
          ...(cfg.stats?.healthScaling ? [`§7Health scale: §f×${boss.healthScale.toFixed(2)} §7(${boss.scaledFor} player(s))`] : []),
          `§7Target: §f${target ? (target.nameTag || target.typeId) : "none"}`,
          `§7Running: §f${[...boss.runs].map((r) => r.skill.name).join(", ") || "-"}`,
          `§7Minions: §f${boss.boundSummons.size}`,
          ...(cds.length ? ["§7Cooldowns:", ...cds.slice(0, 6)] : []), "", "§8Click to refresh",
        ],
        run: again,
      },
      { slot: 28, name: "§aReset", icon: this.icon("reset"), lore: ["§7Full health, first phase,", "§7back to its spawn point."], run: (p) => { boss.reset("menu"); return again(p); } },
      { slot: 29, name: "§cDespawn", icon: this.icon("despawn"), lore: ["§7Remove it: no drops, no death skills."], run: (p) => { this.s.bosses.despawn(boss); return back(p); } },
      {
        slot: 30, name: "§fPrevious phase", icon: this.icon("phase_prev"), lore: [`§7Current: §f${boss.phase}`],
        run: (p) => { if (idx > 0) boss.setPhase(phases[idx - 1].id); return again(p); },
      },
      ...teleport,
      {
        slot: 32, name: "§fNext phase", icon: this.icon("phase_next"), lore: [`§7Current: §f${boss.phase}`, "§8Runs the phase's onEnter skills"],
        run: (p) => { if (idx >= 0 && idx < phases.length - 1) boss.setPhase(phases[idx + 1].id); return again(p); },
      },
      { slot: 33, name: "§eSkills", icon: this.icon("skills"), lore: [`§7${boss.compiled.skills.size} skill(s)`, "§8Cast one now"], run: (p) => this.skills(p, boss, 0) },
    ];
    return this.page(player, `§l${cfg.display?.name ?? "Boss"}`, items, { back });
  }

  /** @param {Player} player @param {import("../core/BossInstance.js").BossInstance} boss @param {number} n */
  skills(player, boss, n) {
    const entries = [...boss.compiled.skills.values()].map((sk) => ({
      name: `§f${sk.name}`, icon: this.icon("skill"),
      lore: [
        `§7Triggers: §f${sk.triggers.map((t) => t.name + (t.arg ? `:${t.arg}` : "")).join(", ") || "called by other skills"}`,
        `§7Cooldown: §f${(sk.cooldown / 20).toFixed(1)}s`, "", "§8Click to cast (ignores cooldown and conditions)",
      ],
      run: (p) => {
        if (!boss.destroyed) this.s.executor.castByName(boss, sk.name, { triggerEntity: p }, { force: true });
        return this.skills(p, boss, n);
      },
    }));
    return this.listPage(player, "§lSkills", entries, n, (p, k) => this.skills(p, boss, k), (p) => this.bossDetail(p, boss.id));
  }

  // -------------------------------------------------------------------------
  // Packs, diagnostics, about
  // -------------------------------------------------------------------------
  /** @param {Player} player @param {number} n */
  packs(player, n) {
    const entries = [...this.s.registrar.packs.values()].map((info) => ({
      name: `§f${info.pack}`, icon: this.icon(info.errors.length ? "pack_error" : "pack"),
      lore: [
        `§7Version: §f${info.ver}`,
        `§7Loaded from: §f${info.source === "cache" ? "cache (instant)" : "transfer"}${info.seen ? "" : " §8(not seen yet)"}`,
        `§7Bosses: §f${info.bosses.filter((b) => (this.s.bosses.configs.get(b)?.config.kind ?? "boss") === "boss").join(", ") || "none"}`,
        `§7Minions: §f${info.bosses.filter((b) => this.s.bosses.configs.get(b)?.config.kind === "minion").join(", ") || "none"}`,
        ...(info.stats ? [`§7Transfer: §f${info.stats.parts} part(s), ${info.stats.chars} chars, ${info.stats.ticks} tick(s)`] : []),
        ...info.errors.slice(0, 4).map((e) => `§c${e}`),
      ],
      run: (p) => this.packs(p, n),
    }));
    if (!entries.length) entries.push({ name: "§7No boss packs connected", icon: this.icon("empty"), lore: [], run: (p) => this.packs(p, 0) });
    return this.listPage(player, "§lBoss packs", entries, n, (p, k) => this.packs(p, k), (p) => this.main(p));
  }

  /** @param {Player} player */
  diagnostics(player) {
    const r = this.s.registrar;
    const probe = r.probe;
    const chars = [...r.packs.values()].reduce((sum, i) => sum + (i.stats?.chars ?? 0), 0);
    /** @type {Item[]} */
    const items = [
      {
        slot: 20, name: "§fScript-event probe", icon: this.icon("probe"),
        lore: [
          "§7Measures the largest message packs can", "§7send and how fast it is delivered.", "",
          probe ? `§7Largest message: §f${probe.maxChars} chars` : "§8Not run yet",
          probe ? `§7Delivery: §f${probe.deliveryTicks ?? "?"} tick(s)` : "", "§8Click to run",
        ],
        run: async (p) => { r.runProbe(); await this.s.adapter.waitTicks(3); return this.diagnostics(p); },
      },
      {
        slot: 22, name: "§fBoss-pack cache", icon: this.icon("clear_cache"),
        lore: [`§7Packs: §f${r.packs.size}`, `§7Transferred this session: §f${chars} chars`, "", "§8Click to clear the cache", "§8(packs re-send their bosses)"],
        run: (p) => { r.clearCache(); Adapter.message(p, "§e[Behemoth] cache cleared; packs are re-sending"); return this.diagnostics(p); },
      },
      {
        slot: 24, name: "§fModules", icon: this.icon("diagnostics"),
        lore: [`§7${this.s.registry.summary()}`], run: (p) => this.diagnostics(p),
      },
    ];
    return this.page(player, "§lDiagnostics", items, { back: (p) => this.main(p) });
  }

  /** @param {Player} player */
  about(player) {
    return this.page(player, "§lAbout", [
      {
        slot: 22, name: `§fBehemoth ${this.version}`, icon: this.icon("about"),
        lore: [
          "§7Boss framework for Minecraft Bedrock.", `§7Boss-pack protocol: §fv${PROTOCOL}`, "",
          "§7Chest UI: Chest-UI by LeGend077 & Herobrine64", "§7(CC BY 4.0)",
        ],
        run: (p) => this.about(p),
      },
    ], { back: (p) => this.main(p) });
  }
}

// Boss loot in a chest (decision D7): when a boss dies its drops go into a
// chest placed on the ground where it died, so players share them out
// themselves. Loot chests are protected from explosions (a boss that explodes
// on death, creepers, TNT) until a player breaks them. The protected list is
// persisted in the world property "bhm:lootchests".
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "./Logger.js";

const KEY = "bhm:lootchests";
const MAX_PROTECTED = 128;
const SWEEP_TICKS = 200;

export class LootChests {
  constructor() {
    /** @type {{ dim: string, x: number, y: number, z: number }[]} */
    this.protected = [];
    /** "dim|x|y|z" lookup for the explosion before-event. @type {Set<string>} */
    this.keys = new Set();
  }

  /** Load the list and hook explosions. Call once, in the first tick. */
  init() {
    try {
      const raw = Adapter.getWorldDynamic(KEY);
      if (typeof raw === "string") this.protected = JSON.parse(raw);
    } catch {
      this.protected = [];
    }
    this.rebuildKeys();
    Adapter.events.onExplosionBefore((dim, loc) => this.keys.has(key(dim, loc)));
  }

  /**
   * Put items into chest(s) at a location; anything that cannot be placed is
   * dropped on the ground instead.
   * @param {import("@minecraft/server").Dimension} dim @param {import("@minecraft/server").Vector3} loc
   * @param {{ item: string, amount: number }[]} items
   */
  place(dim, loc, items) {
    if (!items.length) return [];
    const { placed, leftover } = Adapter.placeLootChests(dim, loc, items);
    for (const p of placed) this.protected.push({ dim: dim.id, x: p.x, y: p.y, z: p.z });
    while (this.protected.length > MAX_PROTECTED) this.protected.shift();
    if (placed.length) {
      this.rebuildKeys();
      this.save();
    }
    for (const it of leftover) {
      if (!Adapter.spawnItem(dim, it.item, it.amount, loc)) Log.warn(`drop "${it.item}" failed to spawn`);
    }
    return placed;
  }

  /**
   * Add items to chests placed earlier (loot dropped during the death sequence); what does not fit
   * goes into new chest(s) next to them.
   * @param {import("@minecraft/server").Dimension} dim @param {import("@minecraft/server").Vector3} loc
   * @param {import("@minecraft/server").Vector3[]} chests @param {{ item: string, amount: number }[]} items
   */
  add(dim, loc, chests, items) {
    const rest = Adapter.addToChests(dim, chests, items);
    return [...chests, ...this.place(dim, loc, rest)];
  }

  /** Forget chests that are gone (broken by a player). @param {number} tick */
  sweep(tick) {
    if (tick % SWEEP_TICKS !== 0 || !this.protected.length) return;
    const keep = this.protected.filter((c) => {
      const type = Adapter.blockTypeAt(c.dim, c);
      return type === "" || type === "minecraft:chest"; // "" = unloaded: keep
    });
    if (keep.length === this.protected.length) return;
    this.protected = keep;
    this.rebuildKeys();
    this.save();
  }

  /** @private */
  rebuildKeys() {
    this.keys = new Set(this.protected.map((c) => key(c.dim, c)));
  }

  /** @private */
  save() {
    Adapter.setWorldDynamic(KEY, this.protected.length ? JSON.stringify(this.protected) : undefined);
  }
}

/** @param {string} dim @param {import("@minecraft/server").Vector3} l */
function key(dim, l) {
  return `${dim}|${Math.floor(l.x)}|${Math.floor(l.y)}|${Math.floor(l.z)}`;
}

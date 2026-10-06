// Damage dealt per player; drives @target selection (design doc §7).
import { Adapter } from "../adapter/Adapter.js";

export class ThreatTable {
  constructor() {
    /** @type {Map<string, number>} entity id → threat */
    this.threat = new Map();
  }

  /** @param {import("@minecraft/server").Entity} entity @param {number} amount */
  add(entity, amount) {
    this.threat.set(entity.id, (this.threat.get(entity.id) ?? 0) + amount);
  }

  /** @param {string} id */
  drop(id) {
    this.threat.delete(id);
  }

  clear() {
    this.threat.clear();
  }

  /**
   * Highest-threat valid player: alive, targetable, same dimension, within range.
   * Invalid entries are pruned.
   * @param {import("@minecraft/server").Dimension} dim
   * @param {import("@minecraft/server").Vector3} loc
   * @param {number} range
   */
  top(dim, loc, range) {
    let best;
    let bestThreat = -Infinity;
    for (const [id, value] of this.threat) {
      const e = Adapter.getEntity(id);
      if (!e || !Adapter.isTargetablePlayer(e)) {
        this.threat.delete(id);
        continue;
      }
      if (e.dimension.id !== dim.id) continue;
      const l = e.location;
      if (Math.hypot(l.x - loc.x, l.y - loc.y, l.z - loc.z) > range) continue;
      if (value > bestThreat) {
        best = e;
        bestThreat = value;
      }
    }
    return best;
  }

  /** @returns {Record<string, number>} */
  serialize() {
    return Object.fromEntries(this.threat);
  }

  /** @param {Record<string, number> | undefined} data */
  restore(data) {
    this.threat = new Map(Object.entries(data ?? {}));
  }
}

// Boss-pack registration over script events (decision D1: the framework is a
// shared library; boss packs ship only their configs + the Behemoth connector).
//
// Protocol v1 (message ids are namespaced "bhm:"):
//   framework → packs   bhm:ready  {p, fw}                 "I'm up — say hello"
//                       bhm:need   {p, pack, hash}         "send me that payload"
//                       bhm:ack    {p, pack, hash, ok, bosses, errors}
//   pack → framework    bhm:hello  {p, pack, ver, hash, size, min}
//                       bhm:part   "<pack>|<hash>|<i>|<n>|<data>"   (raw, no JSON)
//
// Cache-first: every accepted payload is stored in the framework's own world
// storage. On /reload or world load the framework restores all cached bosses in
// its first tick — before any pack speaks — so nothing has to cross between
// packs unless a pack was added or updated (hash differs).
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "./Logger.js";
import { decodeConfigTracks } from "./TrackCodec.js";

export const PROTOCOL = 1;
const CACHE_INDEX = "bhm:cache";
const CACHE_PART = (pack, i) => `bhm:cache:${pack}:${i}`;
/** World dynamic property strings are capped (≈32 KB [VERIFY]); stay well below. */
const CACHE_PART_SIZE = 30000;
/**
 * Packs restored from cache must say hello within this many ticks of our
 * bhm:ready (connectors answer in 1–2 ticks); otherwise the pack is treated as
 * removed: its bosses are unloaded and its cache entry deleted. A slow pack that
 * says hello later is simply re-transferred.
 */
const HELLO_GRACE_TICKS = 100;
/** An unfinished transfer is dropped after this many ticks without new parts. */
const TRANSFER_TIMEOUT_TICKS = 200;
const PACK_ID = /^[a-z0-9_.:-]{1,64}$/;

/** FNV-1a 32-bit over UTF-16 code units — identical in the connector. @param {string} s */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** "1.2.3" ≥ "1.2.0" @param {string} a @param {string} b */
function versionAtLeast(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return true;
}

/**
 * @typedef {{
 *   pack: string, ver: string, hash: string, source: "cache" | "transfer",
 *   bosses: string[], errors: string[], seen: boolean,
 *   stats?: { parts: number, chars: number, ticks: number, ms: number },
 * }} PackInfo
 */

export class Registrar {
  /**
   * @param {import("./services.js").Services} services
   * @param {import("./Validator.js").Validator} validator
   * @param {string} frameworkVersion
   */
  constructor(services, validator, frameworkVersion) {
    this.services = services;
    this.validator = validator;
    this.version = frameworkVersion;
    /** @type {Map<string, PackInfo>} */
    this.packs = new Map();
    /** @type {Map<string, { hash: string, n: number, parts: string[], got: number, startTick: number, lastTick: number, startMs: number }>} */
    this.transfers = new Map();
    /** @type {Map<string, { hash: string, tick: number }>} outstanding bhm:need per pack (dedupes repeat hellos) */
    this.requested = new Map();
    /** @type {Map<string, string>} entity type id → owning pack */
    this.owners = new Map();
    /** @type {{ maxChars: number, deliveryTicks: number | null, tick: number } | null} */
    this.probe = null;
    this.probeSentTick = -1;
    this.cacheLoaded = false;
  }

  start() {
    Adapter.events.onScriptEvent((id, message, meta) => {
      if (!id.startsWith("bhm:")) return;
      // Only script-sent events (no player /scriptevent, no command blocks).
      if (meta.sourceEntity || meta.sourceBlock) {
        Log.warn(`ignored ${id} sent by ${meta.sourceEntity?.typeId ?? "a block"}`);
        return;
      }
      try {
        this.onMessage(id, message);
      } catch (e) {
        Log.error(`registration message ${id} failed:`, e);
      }
    });
    const sched = this.services.scheduler;
    sched.after(1, () => {
      this.restoreCache();
      this.send("bhm:ready", { p: PROTOCOL, fw: this.version });
    });
    sched.after(1 + HELLO_GRACE_TICKS, () => this.forgetSilentPacks());
    sched.onTick((tick) => {
      if (tick % 20 === 0) this.expireTransfers(tick);
    });
  }

  /** @private @param {string} id @param {unknown} body */
  send(id, body) {
    Adapter.sendScriptEvent(id, typeof body === "string" ? body : JSON.stringify(body));
  }

  /** @param {string} id @param {string} message */
  onMessage(id, message) {
    switch (id) {
      case "bhm:hello": return this.onHello(JSON.parse(message));
      case "bhm:part": return this.onPart(message);
      case "bhm:probe": return this.onProbe(message);
      default: return undefined; // our own ready/need/ack, or unknown
    }
  }

  // -------------------------------------------------------------------------
  // Hello / transfer
  // -------------------------------------------------------------------------
  /** @param {{ p: number, pack: string, ver: string, hash: string, size: number, min?: string }} h */
  onHello(h) {
    if (!this.cacheLoaded) this.restoreCache(); // a pack spoke before our first tick
    if (!PACK_ID.test(String(h.pack))) return Log.warn(`hello with invalid pack id "${h.pack}"`);
    if (h.p !== PROTOCOL) return this.ack(h.pack, h.hash, false, [], [`protocol ${h.p} not supported (framework speaks ${PROTOCOL})`]);
    if (h.min && !versionAtLeast(this.version, h.min)) {
      return this.ack(h.pack, h.hash, false, [], [`needs Behemoth ${h.min} or newer (installed: ${this.version})`]);
    }
    const known = this.packs.get(h.pack);
    if (known && known.hash === h.hash) {
      known.seen = true;
      known.ver = h.ver;
      Log.debug(`pack ${h.pack} ${h.ver}: cached copy is current`);
      return this.ack(h.pack, h.hash, true, known.bosses, known.errors);
    }
    this.request(h.pack, h.hash, `${known ? "updated" : "new"} (${h.ver}), requesting ${h.size} chars`);
  }

  /** @param {string} message "<pack>|<hash>|<i>|<n>|<data>" */
  onPart(message) {
    let cut = 0;
    const fields = [];
    for (let k = 0; k < 4; k++) {
      const next = message.indexOf("|", cut);
      if (next < 0) return Log.warn("malformed bhm:part");
      fields.push(message.slice(cut, next));
      cut = next + 1;
    }
    const [pack, hash] = fields;
    const i = Number(fields[2]);
    const n = Number(fields[3]);
    if (!PACK_ID.test(pack) || !(n > 0) || !(i >= 0 && i < n)) return Log.warn("malformed bhm:part header");
    const now = this.services.scheduler.tick;
    let t = this.transfers.get(pack);
    if (!t || t.hash !== hash || t.n !== n) {
      t = { hash, n, parts: new Array(n), got: 0, startTick: now, lastTick: now, startMs: Date.now() };
      this.transfers.set(pack, t);
    }
    if (t.parts[i] === undefined) {
      t.parts[i] = message.slice(cut);
      t.got++;
    }
    t.lastTick = now;
    if (t.got < t.n) return;

    this.transfers.delete(pack);
    this.requested.delete(pack);
    if (this.packs.get(pack)?.hash === hash) return; // duplicate delivery of what we already have
    const payload = t.parts.join("");
    if (fnv1a(payload) !== hash) {
      Log.error(`pack ${pack}: payload checksum mismatch, requesting it again`);
      this.request(pack, hash, "re-requesting after a checksum mismatch", true);
      return;
    }
    const t0 = Date.now();
    const info = this.install(pack, hash, payload, "transfer");
    if (!info) return;
    info.stats = { parts: n, chars: payload.length, ticks: now - t.startTick, ms: Date.now() - t0 };
    Log.info(`pack ${pack} ${info.ver}: ${info.bosses.length} boss(es) registered from ${n} part(s), `
      + `${payload.length} chars in ${info.stats.ticks} tick(s), validated in ${info.stats.ms} ms`);
    this.saveCache(pack, hash, info.ver, payload);
    this.ack(pack, hash, info.errors.length === 0, info.bosses, info.errors);
  }

  /**
   * Ask a pack for its payload, once per hash until it arrives or times out.
   * @private @param {string} pack @param {string} hash @param {string} why @param {boolean} [force]
   */
  request(pack, hash, why, force = false) {
    const now = this.services.scheduler.tick;
    const prev = this.requested.get(pack);
    if (!force && prev && prev.hash === hash && now - prev.tick < TRANSFER_TIMEOUT_TICKS) return;
    this.requested.set(pack, { hash, tick: now });
    Log.info(`pack ${pack}: ${why}`);
    this.send("bhm:need", { p: PROTOCOL, pack, hash });
  }

  /** @private @param {number} tick */
  expireTransfers(tick) {
    for (const [pack, t] of this.transfers) {
      if (tick - t.lastTick < TRANSFER_TIMEOUT_TICKS) continue;
      this.transfers.delete(pack);
      Log.warn(`pack ${pack}: transfer stalled at ${t.got}/${t.n} parts; discarded (it will be requested again on the next hello)`);
    }
  }

  /** @private */
  ack(pack, hash, ok, bosses, errors) {
    for (const e of errors) Log.warn(`pack ${pack}: ${e}`);
    this.send("bhm:ack", { p: PROTOCOL, pack, hash, ok, bosses, errors });
  }

  // -------------------------------------------------------------------------
  // Install
  // -------------------------------------------------------------------------
  /**
   * Validate and bind every boss in a payload. Bosses whose entity type belongs to
   * another pack are refused; the rest of the pack still loads.
   * @param {string} pack @param {string} hash @param {string} payload @param {"cache" | "transfer"} source
   * @returns {PackInfo | undefined}
   */
  install(pack, hash, payload, source) {
    let data;
    try {
      data = JSON.parse(payload);
    } catch (e) {
      Log.error(`pack ${pack}: payload is not valid JSON`, e);
      return undefined;
    }
    /** @type {PackInfo} */
    const info = { pack, ver: String(data.ver ?? "?"), hash, source, bosses: [], errors: [], seen: source === "transfer" };
    let missing = 0;
    for (const config of Array.isArray(data.bosses) ? data.bosses : []) {
      const id = config?.id;
      const owner = id ? this.owners.get(id) : undefined;
      if (owner && owner !== pack) {
        info.errors.push(`${id} is already provided by pack ${owner}; skipped`);
        continue;
      }
      if (id && !Adapter.entityTypeExists(id)) {
        missing++;
        info.errors.push(`${id}: entity type not found (is the pack's entity file present and enabled?)`);
        continue;
      }
      try {
        decodeConfigTracks(config);
      } catch (e) {
        info.errors.push(`${id}: bad baked track data (${e.message})`);
        continue;
      }
      const compiled = this.validator.compile(config);
      if (!compiled) {
        info.errors.push(`${id ?? "<no id>"}: rejected by the validator (see log)`);
        continue;
      }
      this.owners.set(compiled.config.id, pack);
      this.services.bosses.register(compiled);
      info.bosses.push(compiled.config.id);
    }
    if (source === "cache" && info.bosses.length === 0 && missing > 0) {
      // The pack's entities are gone: it was removed from the world.
      this.deleteCacheEntry(pack);
      Log.info(`pack ${pack} is no longer installed; dropped its cached bosses`);
      return undefined;
    }
    // Types the previous version of this pack had but this one dropped.
    const before = this.packs.get(pack);
    for (const id of before?.bosses ?? []) {
      if (!info.bosses.includes(id)) {
        this.owners.delete(id);
        this.services.bosses.unregister(id);
      }
    }
    this.packs.set(pack, info);
    return info;
  }

  // -------------------------------------------------------------------------
  // Cache (framework's own world storage)
  // -------------------------------------------------------------------------
  /** @private */
  readIndex() {
    try {
      const raw = Adapter.getWorldDynamic(CACHE_INDEX);
      return typeof raw === "string" ? JSON.parse(raw) : {};
    } catch {
      Log.warn("boss-pack cache index unreadable; ignoring it");
      return {};
    }
  }

  /** Restore every cached pack. Safe to call more than once. */
  restoreCache() {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    const t0 = Date.now();
    const index = this.readIndex();
    let count = 0;
    for (const [pack, entry] of Object.entries(index)) {
      let payload = "";
      for (let i = 0; i < entry.parts; i++) {
        const part = Adapter.getWorldDynamic(CACHE_PART(pack, i));
        if (typeof part !== "string") {
          payload = "";
          break;
        }
        payload += part;
      }
      if (!payload || fnv1a(payload) !== entry.hash) {
        Log.warn(`cached pack ${pack} is incomplete or corrupt; it will be re-sent by the pack`);
        continue;
      }
      if (this.install(pack, entry.hash, payload, "cache")) count++;
    }
    if (count) Log.info(`restored ${count} boss pack(s) from cache in ${Date.now() - t0} ms`);
  }

  /** @private */
  saveCache(pack, hash, ver, payload) {
    try {
      const index = this.readIndex();
      const old = index[pack]?.parts ?? 0;
      const parts = Math.ceil(payload.length / CACHE_PART_SIZE);
      for (let i = 0; i < parts; i++) Adapter.setWorldDynamic(CACHE_PART(pack, i), payload.slice(i * CACHE_PART_SIZE, (i + 1) * CACHE_PART_SIZE));
      for (let i = parts; i < old; i++) Adapter.setWorldDynamic(CACHE_PART(pack, i), undefined);
      index[pack] = { hash, ver, parts, bosses: this.packs.get(pack)?.bosses ?? [] };
      Adapter.setWorldDynamic(CACHE_INDEX, JSON.stringify(index));
    } catch (e) {
      Log.warn(`could not cache pack ${pack} (it will be re-sent after each reload):`, e);
    }
  }

  /** @private @param {string} pack */
  deleteCacheEntry(pack) {
    const index = this.readIndex();
    const entry = index[pack];
    if (!entry) return;
    for (let i = 0; i < entry.parts; i++) Adapter.setWorldDynamic(CACHE_PART(pack, i), undefined);
    delete index[pack];
    Adapter.setWorldDynamic(CACHE_INDEX, JSON.stringify(index));
  }

  /**
   * Packs restored from cache that never said hello are gone (removed from the
   * world): unload their bosses, forget them and delete their cache entry.
   */
  forgetSilentPacks() {
    for (const [pack, info] of [...this.packs]) {
      if (info.seen) continue;
      for (const id of info.bosses) {
        this.owners.delete(id);
        this.services.bosses.unregister(id);
      }
      this.packs.delete(pack);
      this.deleteCacheEntry(pack);
      Log.info(`pack ${pack} did not respond after loading; unloaded its ${info.bosses.length} boss(es) and removed its cache`);
    }
  }

  /** Forget every cached payload; packs re-send on their next hello (menu action). */
  clearCache() {
    const index = this.readIndex();
    for (const [pack, entry] of Object.entries(index)) {
      for (let i = 0; i < entry.parts; i++) Adapter.setWorldDynamic(CACHE_PART(pack, i), undefined);
    }
    Adapter.setWorldDynamic(CACHE_INDEX, undefined);
    for (const info of this.packs.values()) info.hash = "";
    this.send("bhm:ready", { p: PROTOCOL, fw: this.version });
  }

  // -------------------------------------------------------------------------
  // Diagnostics: largest script-event message and delivery delay
  // -------------------------------------------------------------------------
  runProbe() {
    let max = 0;
    for (let size = 1024; size <= 262144; size *= 2) {
      if (!Adapter.sendScriptEvent("bhm:probe_size", "x".repeat(size))) break;
      max = size;
    }
    this.probe = { maxChars: max, deliveryTicks: null, tick: this.services.scheduler.tick };
    this.probeSentTick = this.services.scheduler.tick;
    Adapter.sendScriptEvent("bhm:probe", String(this.probeSentTick));
    Log.info(`probe: script-event messages accepted up to at least ${max} chars`);
  }

  /** @private @param {string} message */
  onProbe(message) {
    if (!this.probe || Number(message) !== this.probeSentTick) return;
    this.probe.deliveryTicks = this.services.scheduler.tick - this.probeSentTick;
    Log.info(`probe: script events delivered after ${this.probe.deliveryTicks} tick(s)`);
  }
}

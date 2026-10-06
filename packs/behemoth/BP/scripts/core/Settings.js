// Framework settings, edited from the /behemoth menu and persisted in the
// world (dynamic property "bhm:settings"), so they survive /reload and restarts.
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "./Logger.js";
import { Random } from "./Random.js";

const KEY = "bhm:settings";
const LOG_LEVELS = /** @type {const} */ (["error", "warn", "info", "debug"]);

/**
 * @typedef {{
 *   logLevel: "error" | "warn" | "info" | "debug",
 *   overlay: boolean,
 *   boneMarkers: boolean,
 *   hitboxes: boolean,
 *   seed: number | null,
 *   iconSet: "vanilla" | "custom",
 * }} SettingsData
 */

/** @type {SettingsData} */
const DEFAULTS = { logLevel: "info", overlay: false, boneMarkers: false, hitboxes: false, seed: null, iconSet: "vanilla" };

export class Settings {
  constructor() {
    /** @type {SettingsData} */
    this.data = { ...DEFAULTS };
  }

  /** Read saved settings (call once the world is loaded) and apply them. */
  load() {
    try {
      const raw = Adapter.getWorldDynamic(KEY);
      if (typeof raw === "string") this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      Log.warn("settings were unreadable; using defaults");
    }
    this.apply();
  }

  /** @private */
  save() {
    try {
      Adapter.setWorldDynamic(KEY, JSON.stringify(this.data));
    } catch (e) {
      Log.warn("could not save settings:", e);
    }
  }

  /** @private Push values into the subsystems that read them. */
  apply() {
    Log.setLevel(this.data.logLevel);
    Random.setSeed(this.data.seed ?? undefined);
  }

  /**
   * @template {keyof SettingsData} K
   * @param {K} key @param {SettingsData[K]} value
   */
  set(key, value) {
    this.data[key] = value;
    this.apply();
    this.save();
  }

  /** @param {"overlay" | "boneMarkers" | "hitboxes"} key */
  toggle(key) {
    this.set(key, !this.data[key]);
    return this.data[key];
  }

  cycleLogLevel() {
    const next = LOG_LEVELS[(LOG_LEVELS.indexOf(this.data.logLevel) + 1) % LOG_LEVELS.length];
    this.set("logLevel", next);
    return next;
  }

  get overlay() { return this.data.overlay; }
  get boneMarkers() { return this.data.boneMarkers; }
  get hitboxes() { return this.data.hitboxes; }
  get iconSet() { return this.data.iconSet; }
}
